import { connect, createServer, type Server, type Socket } from 'node:net';

import { UsageError } from '../errors';
import { join } from '../filesystem/index';

/**
 * The sandbox's ports on the host's `127.0.0.1`: each connection goes to the
 * unix socket the bridge listens on inside the sandbox, which connects to
 * that port on the sandbox's own loopback. Only what was published, and only
 * from this machine.
 */
export class PublishedPorts {
  private servers: Server[] = [];

  public constructor(
    private readonly ports: readonly number[],
    /** Where the bridge puts one socket per port (see `socketFor`). */
    private readonly dir: string,
  ) {}

  public async start(): Promise<void> {
    if (this.servers.length > 0) return;

    for (const port of this.ports) {
      const socket = socketFor(this.dir, port);
      const server = createServer((client) => {
        pipe(client, connect(socket));
      });
      try {
        await listen(server, port);
      } catch {
        await this.close();
        throw new UsageError(
          `A porta ${String(port)} já está em uso no host; não dá para publicar a porta da sandbox nela.`,
        );
      }
      this.servers.push(server);
    }
  }

  public async close(): Promise<void> {
    const servers = this.servers;
    this.servers = [];
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          }),
      ),
    );
  }
}

/** The socket the bridge listens on for `port`. */
export function socketFor(dir: string, port: number): string {
  return join(dir, `${String(port)}.sock`);
}

/** A workspace port: an integer from 1 to 65535. */
export function validatePorts(ports: readonly number[]): void {
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new UsageError(
        `Porta inválida em ports: ${String(port)}. Use um número de 1 a 65535.`,
      );
    }
  }
}

function pipe(client: Socket, upstream: Socket): void {
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}
