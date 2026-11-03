/**
 * Runs inside the sandbox's network namespace: the sandbox has only
 * loopback, and this is what listens on it.
 *
 *   bridge-main <proxy.sock> <proxy port> [--forward host:port]…
 *               [--publish port:socket]… [--ready <file>] [-- <command> …]
 *
 * - `127.0.0.1:<proxy port>` is the HTTP proxy the CLIs are pointed at; each
 *   connection is piped as is to Goiaba's proxy socket.
 * - each `--forward host:port` (a loopback address the provider needs, e.g.
 *   Ollama) is listened on with the same address inside, and tunneled
 *   through the proxy with CONNECT, so the gate decides it too.
 * - each `--publish port:socket` is the other way in: a connection to the
 *   unix socket (Goiaba's side of a workspace `ports` entry) goes to that
 *   port on the sandbox's loopback.
 *
 * Alone (bubblewrap: a jail that lives for the workspace), it writes the
 * `--ready` file once everything listens and exits when Goiaba (its parent)
 * is gone. With `-- <command>` (docker: a container per command), it is the
 * launcher: once everything listens it runs the command and exits with it.
 */
import { connect, createServer, type Server, type Socket } from 'node:net';

import {
  exitProgram,
  parentPid,
  programArguments,
  runAttached,
} from '../execute/process';
import { removePath, writeText } from '../filesystem/index';
import { PARENT_CHECK_MS } from './constants';

const HEADER_END = '\r\n\r\n';

interface BridgeArguments {
  readonly socketPath: string;
  readonly proxyPort: number;
  readonly forwards: readonly string[];
  readonly publish: readonly {
    readonly port: number;
    readonly socket: string;
  }[];
  readonly ready: string | undefined;
  readonly command: readonly string[];
}

async function main(): Promise<void> {
  const args = parseArguments(programArguments());
  if (args === undefined) exitProgram(2);
  const { socketPath, proxyPort, forwards, publish, ready, command } = args;

  await listen(
    createServer((client) => {
      pipeTo(client, connect(socketPath));
    }),
    proxyPort,
    '127.0.0.1',
  );
  for (const forward of forwards) {
    const { host, port } = splitAddress(forward);
    await listen(
      createServer((client) => {
        tunnel(client, socketPath, forward);
      }),
      port,
      host,
    );
  }

  for (const { port, socket } of publish) {
    // A previous container for the same workspace may have left it.
    removePath(socket);
    await listenOn(
      createServer((client) => {
        pipeTo(client, connect(port, '127.0.0.1'));
      }),
      socket,
    );
  }

  const executable = command.at(0);
  if (executable !== undefined) {
    exitProgram(await runAttached(executable, command.slice(1)));
  }
  if (ready !== undefined) writeText(ready, '');
  exitWithParent();
}

function parseArguments(args: readonly string[]): BridgeArguments | undefined {
  const socketPath = args.at(0);
  const proxyPort = Number(args.at(1));
  if (socketPath === undefined || !Number.isInteger(proxyPort)) {
    return undefined;
  }

  const forwards: string[] = [];
  const publish: { port: number; socket: string }[] = [];
  let ready: string | undefined;
  let index = 2;
  while (index < args.length) {
    const flag = args.at(index);
    const value = args.at(index + 1);
    if (flag === '--') {
      return {
        socketPath,
        proxyPort,
        forwards,
        publish,
        ready,
        command: args.slice(index + 1),
      };
    }
    if (value === undefined) return undefined;
    if (flag === '--forward') forwards.push(value);
    else if (flag === '--publish') {
      const separator = value.indexOf(':');
      publish.push({
        port: Number(value.slice(0, separator)),
        socket: value.slice(separator + 1),
      });
    } else if (flag === '--ready') ready = value;
    else return undefined;
    index += 2;
  }
  return { socketPath, proxyPort, forwards, publish, ready, command: [] };
}

function pipeTo(client: Socket, upstream: Socket): void {
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
}

/** Asks the proxy for a CONNECT tunnel to `authority`, then pipes through it. */
function tunnel(client: Socket, socketPath: string, authority: string): void {
  client.pause();
  const upstream = connect(socketPath);
  let response = Buffer.alloc(0);

  const onData = (chunk: Buffer): void => {
    response = Buffer.concat([response, chunk]);
    const end = response.indexOf(HEADER_END);
    if (end === -1) return;

    upstream.off('data', onData);
    if (!response.subarray(0, end).toString().startsWith('HTTP/1.1 200')) {
      client.destroy();
      upstream.destroy();
      return;
    }
    const rest = response.subarray(end + HEADER_END.length);
    if (rest.length > 0) client.write(rest);
    pipeTo(client, upstream);
    client.resume();
  };

  upstream.on('data', onData);
  upstream.on('error', () => client.destroy());
  upstream.write(
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}${HEADER_END}`,
  );
}

/** `127.0.0.1:11434`, `[::1]:11434` → host and port. */
function splitAddress(address: string): {
  readonly host: string;
  readonly port: number;
} {
  const separator = address.lastIndexOf(':');
  const host = address.slice(0, separator).replace(/^\[(.*)\]$/, '$1');
  return {
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: Number(address.slice(separator + 1)),
  };
}

function listenOn(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** Reparented (Goiaba died, even by SIGKILL): nobody is left to serve. */
function exitWithParent(): void {
  const parent = parentPid();
  setInterval(() => {
    if (parentPid() !== parent) exitProgram(0);
  }, PARENT_CHECK_MS);
}

await main();
