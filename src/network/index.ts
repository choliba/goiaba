import { randomUUID } from 'node:crypto';

import { UsageError } from '../errors';
import type { ProgramCommand } from '../execute/types';
import {
  goiabaCacheDir,
  runtimeExecutable,
  startHelper,
  type Helper,
} from '../execute/process';
import {
  ensureDirectory,
  join,
  pathExists,
  removePath,
} from '../filesystem/index';
import { localPorts } from './rules';
import { NetworkGate, type NetworkGateOptions } from './gate';
import { NetworkProxy } from './proxy';
import { PublishedPorts, socketFor } from './publish';

export * from './types';
export * from './rules';
export { NETWORK_SOURCE, NetworkGate, type NetworkGateOptions } from './gate';
export { NetworkProxy } from './proxy';
export { validatePorts } from './publish';

/** Where the CLIs inside the jail find the proxy (the jail's own loopback). */
export const PROXY_PORT = 3128;

const SOCKET_FILE = 'proxy.sock';
/** The published ports' sockets: the only place the sandbox writes here. */
const PORTS_DIR = 'ports';
const READY_FILE = 'ready';
const READY_TIMEOUT_MS = 5000;
const READY_POLL_MS = 20;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * The only way out of a sandbox without network: Goiaba's proxy, on a unix
 * socket on the host, and a bridge inside the sandbox's network that listens
 * on its loopback and carries everything to that socket (`attach` for a
 * long-lived jail, `launcher` for a container per command). What does not go
 * through the proxy has nowhere to go.
 */
export class NetworkBoundary {
  private readonly gate: NetworkGate;
  private readonly proxy: NetworkProxy;
  private readonly dir = join(
    goiabaCacheDir(),
    'network',
    randomUUID().slice(0, 8),
  );
  private readonly forwards: readonly string[];
  private ports: readonly number[] = [];
  private published: PublishedPorts | undefined;
  private bridge: Helper | undefined;

  public constructor(options: NetworkGateOptions) {
    this.gate = new NetworkGate(options);
    this.proxy = new NetworkProxy(this.gate);
    this.forwards = [
      ...new Set([
        ...(options.alwaysAllow ?? []).filter(isLocal),
        ...localPorts(options.rules),
      ]),
    ];
  }

  /**
   * Ports of the sandbox opened on the host's `127.0.0.1` (the workspace's
   * `ports`): the way in, next to the way out.
   */
  public publish(ports: readonly number[]): void {
    const taken = ports.find((port) =>
      this.forwards.some((forward) => portOf(forward) === port),
    );
    if (taken !== undefined) {
      throw new UsageError(
        `A porta ${String(taken)} não pode estar em ports e em localhost:${String(taken)} nas regras de network: uma é da sandbox, a outra é do host.`,
      );
    }
    this.ports = ports;
  }

  /**
   * Where the bridge creates the published ports' sockets: a sandbox that
   * sees the host read-only must mount it writable.
   */
  public portsDir(): string {
    return join(this.dir, PORTS_DIR);
  }

  /**
   * What commands in the jail need to use the proxy. The jail's own loopback
   * stays direct (a dev server the agent started); the provider's local
   * endpoints and the policy's `localhost:<port>` there are the bridge's
   * tunnels to the host.
   */
  public environment(): readonly string[] {
    const proxy = `http://127.0.0.1:${String(PROXY_PORT)}`;
    const local = LOCAL_HOSTS.join(',');
    return [
      `HTTP_PROXY=${proxy}`,
      `HTTPS_PROXY=${proxy}`,
      `ALL_PROXY=${proxy}`,
      `http_proxy=${proxy}`,
      `https_proxy=${proxy}`,
      `all_proxy=${proxy}`,
      `NO_PROXY=${local}`,
      `no_proxy=${local}`,
    ];
  }

  /**
   * Starts the proxy and, through `enter` (which puts a command in the jail's
   * network), the bridge. Again for a new jail replaces the old bridge.
   */
  public async attach(
    enter: (command: ProgramCommand) => ProgramCommand,
  ): Promise<void> {
    await this.startProxy();
    await this.bridge?.stop();

    const ready = join(this.dir, READY_FILE);
    removePath(ready);
    const command = enter({
      executable: runtimeExecutable(),
      arguments: [...this.bridgeArguments(), '--ready', ready],
    });
    const bridge = startHelper(command.executable, command.arguments ?? [], {
      cwd: this.dir,
    });
    this.bridge = bridge;
    let exited = false;
    bridge.onExit(() => {
      exited = true;
    });

    if (!(await appears(ready, () => !exited))) {
      throw new UsageError(
        'Não foi possível abrir a saída de rede da sandbox.',
      );
    }
  }

  /**
   * argv that, run inside a sandbox without network, opens the way out there
   * and then runs the command given after it (a container per command).
   */
  public async launcher(): Promise<readonly string[]> {
    await this.startProxy();
    return [runtimeExecutable(), ...this.bridgeArguments(), '--'];
  }

  private async startProxy(): Promise<void> {
    ensureDirectory(this.portsDir(), 0o700);
    await this.proxy.start(join(this.dir, SOCKET_FILE));
    this.published ??= new PublishedPorts(this.ports, this.portsDir());
    await this.published.start();
  }

  private bridgeArguments(): string[] {
    return [
      new URL('./bridge-main.ts', import.meta.url).pathname,
      join(this.dir, SOCKET_FILE),
      String(PROXY_PORT),
      ...this.forwards.flatMap((forward) => ['--forward', forward]),
      ...this.ports.flatMap((port) => [
        '--publish',
        `${String(port)}:${socketFor(this.portsDir(), port)}`,
      ]),
    ];
  }

  public async close(): Promise<void> {
    const bridge = this.bridge;
    this.bridge = undefined;
    await bridge?.stop();
    await this.published?.close();
    this.published = undefined;
    await this.proxy.close();
    removePath(this.dir);
  }
}

function portOf(address: string): number {
  return Number(address.slice(address.lastIndexOf(':') + 1));
}

function isLocal(endpoint: string): boolean {
  const host = endpoint
    .slice(0, endpoint.lastIndexOf(':'))
    .replace(/^\[(.*)\]$/, '$1');
  return LOCAL_HOSTS.includes(host) || host.startsWith('127.');
}

async function appears(path: string, waiting: () => boolean): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline && waiting()) {
    if (pathExists(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return pathExists(path);
}
