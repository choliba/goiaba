import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { PassThrough, type Duplex } from 'node:stream';

import { log } from '../logger/index';
import {
  BAD_GATEWAY,
  FORBIDDEN,
  MAX_OBSERVED_BYTES,
  MAX_REWRITE_BODY_BYTES,
} from './constants';
import type { NetworkGate } from './gate';
import { RequestRewriteStream } from './rewrite';
import type {
  NetworkRequest,
  RequestRewriter,
  RewriteRequest,
  TrafficObserver,
} from './types';

/**
 * HTTP proxy (plain requests and CONNECT tunnels) on a unix socket: the only
 * way out of a sandbox without network. Every destination goes through the
 * gate first.
 */
export class NetworkProxy {
  private readonly server: Server = createServer();
  private socketPath: string | undefined;

  private readonly observers: TrafficObserver[];
  private readonly rewriters: RequestRewriter[];

  public constructor(
    private readonly gate: NetworkGate,
    observers: readonly TrafficObserver[] = [],
    /** See `MAX_OBSERVED_BYTES`. */
    private readonly maxObservedBytes = MAX_OBSERVED_BYTES,
    rewriters: readonly RequestRewriter[] = [],
    /** See `MAX_REWRITE_BODY_BYTES`. */
    private readonly maxRewriteBodyBytes = MAX_REWRITE_BODY_BYTES,
  ) {
    this.observers = [...observers];
    this.rewriters = [...rewriters];
    this.server.on('request', (request, response) => {
      void forwardHttp(
        this.gate,
        request,
        response,
        this.rewriters,
        this.maxRewriteBodyBytes,
      );
    });
    this.server.on('connect', (request, socket, head) => {
      void forwardTunnel(this.gate, request, socket, head, {
        observers: this.observers,
        maxObservedBytes: this.maxObservedBytes,
        rewriters: this.rewriters,
        maxRewriteBodyBytes: this.maxRewriteBodyBytes,
      });
    });
  }

  /** Reads `observer.destination`'s traffic from the next connection on. */
  public observe(observer: TrafficObserver): void {
    this.observers.push(observer);
  }

  /** Changes what `rewriter.destination` receives, from the next connection on. */
  public rewrite(rewriter: RequestRewriter): void {
    this.rewriters.push(rewriter);
  }

  /** Listens on `path`; again on the same path is a no-op. */
  public async start(path: string): Promise<void> {
    if (this.socketPath !== undefined) return;
    await listen(this.server, path);
    this.socketPath = path;
  }

  public async close(): Promise<void> {
    this.socketPath = undefined;
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/**
 * The rewriters of `request`'s destination as one: each gets the body the
 * one before left. `undefined` when the destination has none.
 */
function rewriterFor(
  rewriters: readonly RequestRewriter[],
  request: NetworkRequest,
): RewriteRequest | undefined {
  const destination = `${request.hostname}:${String(request.port)}`;
  const own = rewriters.filter(
    (rewriter) => rewriter.destination === destination,
  );
  if (own.length === 0) return undefined;
  return (parts) => {
    let body: Uint8Array | undefined;
    for (const { rewrite } of own) {
      body = rewrite({ ...parts, body: body ?? parts.body }) ?? body;
    }
    return body;
  };
}

/** The whole body of `incoming`, or `undefined` past `maxBytes`. */
async function readBody(
  incoming: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of incoming) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += part.length;
    if (total > maxBytes) return undefined;
    parts.push(part);
  }
  return Buffer.concat(parts);
}

async function forwardHttp(
  gate: NetworkGate,
  incoming: IncomingMessage,
  response: ServerResponse,
  rewriters: readonly RequestRewriter[],
  maxRewriteBodyBytes: number,
): Promise<void> {
  const target = httpTarget(incoming);
  if (target === undefined) {
    response.writeHead(BAD_GATEWAY).end('Destino inválido.');
    return;
  }
  const decision = await gate.decide(target.request);
  if (decision.decision === 'deny') {
    response.writeHead(FORBIDDEN).end(decision.reason);
    return;
  }

  const rewrite =
    target.url.protocol === 'http:'
      ? rewriterFor(rewriters, target.request)
      : undefined;
  // A body to change is read whole first; past the limit it is refused
  // rather than sent half changed.
  const body =
    rewrite === undefined
      ? undefined
      : await readBody(incoming, maxRewriteBodyBytes);
  if (rewrite !== undefined && body === undefined) {
    response.writeHead(BAD_GATEWAY).end('Pedido grande demais para ajustar.');
    return;
  }
  const rewritten =
    rewrite === undefined || body === undefined
      ? undefined
      : (rewrite({
          method: incoming.method ?? 'GET',
          path: `${target.url.pathname}${target.url.search}`,
          body,
        }) ?? body);

  const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = withoutProxyHeaders(incoming.headers);
  const outgoing = send(target.url, {
    method: incoming.method,
    headers:
      rewritten === undefined
        ? headers
        : {
            ...withoutFraming(headers),
            'content-length': String(rewritten.length),
          },
  });
  outgoing.on('response', (upstream) => {
    response.writeHead(upstream.statusCode ?? BAD_GATEWAY, upstream.headers);
    upstream.pipe(response);
  });
  outgoing.on('error', (error) => {
    logFailure(target.request, error);
    if (!response.headersSent) response.writeHead(BAD_GATEWAY);
    response.end('Falha no destino.');
  });
  if (rewritten === undefined) incoming.pipe(outgoing);
  else outgoing.end(rewritten);
}

async function forwardTunnel(
  gate: NetworkGate,
  incoming: IncomingMessage,
  client: Duplex,
  head: Buffer,
  {
    observers,
    maxObservedBytes,
    rewriters,
    maxRewriteBodyBytes,
  }: {
    readonly observers: readonly TrafficObserver[];
    readonly maxObservedBytes: number;
    readonly rewriters: readonly RequestRewriter[];
    readonly maxRewriteBodyBytes: number;
  },
): Promise<void> {
  client.on('error', () => undefined);
  const request = tunnelTarget(incoming.url);
  if (request === undefined) {
    rejectTunnel(client, BAD_GATEWAY, 'Destino inválido.');
    return;
  }
  const decision = await gate.decide(request);
  if (decision.decision === 'deny') {
    rejectTunnel(client, FORBIDDEN, decision.reason);
    return;
  }

  const upstream = connect(request.port, request.hostname);
  const rewrite = rewriterFor(rewriters, request);
  upstream.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(client);
    if (rewrite === undefined) {
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
    } else {
      // The requests go through the rewriter, `head` (what came with the
      // CONNECT) first.
      const rewriting = new RequestRewriteStream(rewrite, maxRewriteBodyBytes);
      rewriting.on('error', () => upstream.destroy());
      rewriting.pipe(upstream);
      if (head.length > 0) rewriting.write(head);
      client.pipe(rewriting);
    }
    observe(observers, request, client, upstream, maxObservedBytes);
  });
  upstream.on('error', (error) => {
    logFailure(request, error);
    rejectTunnel(client, BAD_GATEWAY, 'Falha no destino.');
  });
  client.on('close', () => upstream.destroy());
}

function httpTarget(
  request: IncomingMessage,
): { readonly url: URL; readonly request: NetworkRequest } | undefined {
  try {
    const url = new URL(
      request.url ?? '',
      `http://${request.headers.host ?? ''}`,
    );
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    const port = url.port.length > 0 ? Number(url.port) : defaultPort(protocol);
    if (!validPort(port) || url.hostname.length === 0) return undefined;
    return { url, request: { hostname: hostOf(url), port, protocol } };
  } catch {
    return undefined;
  }
}

function tunnelTarget(
  authority: string | undefined,
): NetworkRequest | undefined {
  if (authority === undefined) return undefined;
  try {
    const url = new URL(`https://${authority}`);
    const port = url.port.length > 0 ? Number(url.port) : defaultPort('https');
    return validPort(port) && url.hostname.length > 0
      ? { hostname: hostOf(url), port, protocol: 'https' }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A copy of each side of the tunnel, for the observers of its destination.
 * An observer that fails or stops reading never touches the connection.
 */
function observe(
  observers: readonly TrafficObserver[],
  request: NetworkRequest,
  client: Duplex,
  upstream: Duplex,
  maxObservedBytes: number,
): void {
  const destination = `${request.hostname}:${String(request.port)}`;
  for (const observer of observers) {
    if (observer.destination !== destination) continue;
    try {
      observer.observe({
        requests: copyOf(client, maxObservedBytes),
        responses: copyOf(upstream, maxObservedBytes),
      });
    } catch (error) {
      log.debug({
        type: 'network_observer_failure',
        destination,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * What `source` carries from now on, until it closes, or until the observer
 * falls `maxObservedBytes` behind: then the copy ends there.
 */
function copyOf(
  source: Duplex,
  maxObservedBytes: number,
): AsyncIterable<Uint8Array> {
  const copy = new PassThrough();
  copy.on('error', () => undefined);
  const stop = (): void => {
    source.off('data', onData);
    copy.end();
  };
  const onData = (chunk: Buffer): void => {
    if (copy.writableLength + chunk.length > maxObservedBytes) {
      log.debug({
        type: 'network_observer_behind',
        bytes: copy.writableLength,
      });
      stop();
      return;
    }
    copy.write(chunk);
  };
  source.on('data', onData);
  source.on('close', stop);
  return copy;
}

/** Allowed, but the destination failed (DNS, refused, reset): the CLI gets 502. */
function logFailure(request: NetworkRequest, error: Error): void {
  log.debug({ type: 'network_failure', ...request, message: error.message });
}

/** `[::1]` → `::1`, as policies and `connect` write it. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

function defaultPort(protocol: 'http' | 'https'): number {
  return protocol === 'https' ? 443 : 80;
}

function withoutProxyHeaders(
  headers: IncomingMessage['headers'],
): IncomingMessage['headers'] {
  const {
    'proxy-authorization': _authorization,
    'proxy-connection': _connection,
    ...kept
  } = headers;
  return kept;
}

/** Headers without their body framing, for a body sent with a new length. */
function withoutFraming(
  headers: IncomingMessage['headers'],
): IncomingMessage['headers'] {
  const {
    'content-length': _length,
    'transfer-encoding': _encoding,
    ...kept
  } = headers;
  return kept;
}

function rejectTunnel(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  const length = String(Buffer.byteLength(reason));
  socket.end(
    `HTTP/1.1 ${String(status)} Rejected\r\nContent-Length: ${length}\r\n\r\n${reason}`,
  );
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
