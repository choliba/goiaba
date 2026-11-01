import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

import { log } from '../logger/index';
import type { NetworkGate } from './gate';
import type { NetworkRequest } from './types';

const BAD_GATEWAY = 502;
const FORBIDDEN = 403;

/**
 * HTTP proxy (plain requests and CONNECT tunnels) on a unix socket: the only
 * way out of a sandbox without network. Every destination goes through the
 * gate first.
 */
export class NetworkProxy {
  private readonly server: Server = createServer();
  private socketPath: string | undefined;

  public constructor(private readonly gate: NetworkGate) {
    this.server.on('request', (request, response) => {
      void forwardHttp(this.gate, request, response);
    });
    this.server.on('connect', (request, socket, head) => {
      void forwardTunnel(this.gate, request, socket, head);
    });
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

async function forwardHttp(
  gate: NetworkGate,
  incoming: IncomingMessage,
  response: ServerResponse,
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

  const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const outgoing = send(target.url, {
    method: incoming.method,
    headers: withoutProxyHeaders(incoming.headers),
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
  incoming.pipe(outgoing);
}

async function forwardTunnel(
  gate: NetworkGate,
  incoming: IncomingMessage,
  client: Duplex,
  head: Buffer,
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
  upstream.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
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
