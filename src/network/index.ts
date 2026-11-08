import { randomUUID } from 'node:crypto';

import { UsageError } from '../errors';
import type { ProgramCommand } from '../execute/types';
import {
  runtimeExecutable,
  startHelper,
  type Helper,
  environment,
} from '../execute/process';
import {
  ensureDirectory,
  join,
  pathExists,
  removePath,
  goiabaCacheDir,
} from '../filesystem/index';
import { localPorts } from './rules';
import { NetworkGate, type NetworkGateOptions } from './gate';
import type { RequestRewriter, TrafficObserver } from './types';
import { PROXY_PORT, READY_POLL_MS, READY_TIMEOUT_MS } from './constants';
import { NetworkProxy } from './proxy';
import { PublishedPorts, socketFor } from './publish';

export * from './types';
export * from './rules';
export { NETWORK_SOURCE, NetworkGate, type NetworkGateOptions } from './gate';
export { NetworkProxy } from './proxy';
export { validatePorts } from './publish';

export * from './constants';

export interface NetworkBoundaryOptions extends NetworkGateOptions {
  /** Read what these destinations send back (e.g. a local model's usage). */
  readonly observe?: readonly TrafficObserver[];
  /** See `PROXY_PORT`. */
  readonly proxyPort?: number;
  /** See `READY_TIMEOUT_MS`. */
  readonly readyTimeoutMs?: number;
  /** See `MAX_OBSERVED_BYTES`. */
  readonly maxObservedBytes?: number;
  /** Change what these destinations receive (e.g. a local model's options). */
  readonly rewrite?: readonly RequestRewriter[];
  /** See `MAX_REWRITE_BODY_BYTES`. */
  readonly maxRewriteBodyBytes?: number;
}

const SOCKET_FILE = 'proxy.sock';
/** The bridge, bundled: the sandbox runs it without seeing Goiaba's code. */
const BRIDGE_FILE = 'bridge.js';
/** The published ports' sockets, inside the boundary's directory. */
const PORTS_DIR = 'ports';
const READY_FILE = 'ready';
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
    goiabaCacheDir(environment()),
    'network',
    randomUUID().slice(0, 8),
  );
  private readonly forwards: readonly string[];
  private ports: readonly number[] = [];
  private published: PublishedPorts | undefined;
  private bridge: Helper | undefined;
  private bundled = false;
  private readonly proxyPort: number;
  private readonly readyTimeoutMs: number;

  public constructor(options: NetworkBoundaryOptions) {
    this.gate = new NetworkGate(options);
    this.proxy = new NetworkProxy(
      this.gate,
      options.observe,
      options.maxObservedBytes,
      options.rewrite,
      options.maxRewriteBodyBytes,
    );
    this.proxyPort = options.proxyPort ?? PROXY_PORT;
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.forwards = [
      ...new Set([
        ...(options.alwaysAllow ?? []).filter(isLocal),
        ...localPorts(options.rules),
      ]),
    ];
  }

  /** Reads a destination's traffic too; the decisions do not change. */
  public observe(observer: TrafficObserver): void {
    this.proxy.observe(observer);
  }

  /** Changes what a destination receives too; the decisions do not change. */
  public rewrite(rewriter: RequestRewriter): void {
    this.proxy.rewrite(rewriter);
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
   * This boundary's own directory (the proxy's socket, the published ports'
   * sockets): a sandbox that runs the bridge inside must mount it writable,
   * and nothing else of Goiaba's cache.
   */
  public sandboxDir(): string {
    return this.dir;
  }

  private portsDir(): string {
    return join(this.dir, PORTS_DIR);
  }

  /**
   * What commands in the jail need to use the proxy. The jail's own loopback
   * stays direct (a dev server the agent started); the provider's local
   * endpoints and the policy's `localhost:<port>` there are the bridge's
   * tunnels to the host.
   */
  public environment(): readonly string[] {
    const proxy = `http://127.0.0.1:${String(this.proxyPort)}`;
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

    if (!(await appears(ready, () => !exited, this.readyTimeoutMs))) {
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
    if (!this.bundled) {
      await bundleBridge(this.dir);
      this.bundled = true;
    }
    await this.proxy.start(join(this.dir, SOCKET_FILE));
    this.published ??= new PublishedPorts(this.ports, this.portsDir());
    await this.published.start();
  }

  private bridgeArguments(): string[] {
    return [
      join(this.dir, BRIDGE_FILE),
      join(this.dir, SOCKET_FILE),
      String(this.proxyPort),
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
    this.bundled = false;
  }
}

async function bundleBridge(dir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [new URL('./bridge-main.ts', import.meta.url).pathname],
    outdir: dir,
    naming: BRIDGE_FILE,
    target: 'bun',
  });

  if (!result.success) {
    throw new UsageError(
      `Não foi possível preparar a saída de rede da sandbox: ${result.logs.map(String).join('; ')}`,
    );
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

async function appears(
  path: string,
  waiting: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && waiting()) {
    if (pathExists(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return pathExists(path);
}
