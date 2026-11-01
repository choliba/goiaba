import type { ProgramCommand } from '../execute/types';
import { UsageError } from '../errors';
import { resolve } from '../filesystem/index';
import { compileFilesystemAccess, type AgentPolicy } from '../policy/index';
import {
  NetworkBoundary,
  networkRulesOf,
  validatePorts,
  type NetworkApprover,
  type NetworkLedger,
} from '../network/index';
import type { SandboxHost } from './sandbox/host-access';
import {
  BubblewrapSandbox,
  DockerSandbox,
  type Sandbox,
} from './sandbox/index';

export type WorkspaceType = 'docker' | 'bubblewrap';

export interface DockerWorkspaceOptions {
  readonly type: 'docker';
  readonly root: string;
  readonly image: string;
  readonly writable?: readonly string[];
  /** See {@link BubblewrapWorkspaceOptions.ports}. */
  readonly ports?: readonly number[];
}

export interface BubblewrapWorkspaceOptions {
  readonly type: 'bubblewrap';
  readonly root: string;
  readonly writable?: readonly string[];
  /**
   * Ports of the sandbox you reach at `127.0.0.1:<port>` on the host (e.g. a
   * dev server the agent started). Without network rules the sandbox shares
   * the host's network and they are there already; with them, Goiaba opens
   * them. A way in for you, not a way out for the agent.
   */
  readonly ports?: readonly number[];
}

export type WorkspaceOptions =
  DockerWorkspaceOptions | BubblewrapWorkspaceOptions;

/**
 * What the network needs besides its rules, which come from the policy:
 * who asks about what the rules leave open, where approvals and decisions
 * are kept, and the destinations always allowed or denied (an agent's
 * model API, its CLI's background traffic).
 */
export interface WorkspaceNetworkOptions {
  readonly approve: NetworkApprover;
  readonly ledger?: NetworkLedger;
  readonly alwaysAllow?: readonly string[];
  readonly alwaysDeny?: readonly string[];
}

export class Workspace {
  public readonly type: WorkspaceType;
  public readonly root: string;
  /** As created: type, root, image, writable paths. */
  public readonly options: WorkspaceOptions;
  public readonly sandbox: Sandbox;
  private network: NetworkBoundary | undefined;

  public constructor(options: WorkspaceOptions) {
    if (options.root.trim().length === 0) {
      throw new UsageError('A raiz do workspace não pode estar vazia.');
    }
    // The root is mounted writable over everything: `/` would hand the agent
    // the whole host (and the host's /dev, where the CLIs' terminals fail).
    if (resolve(options.root) === '/') {
      throw new UsageError(
        'A raiz do workspace não pode ser /: o agente teria escrita no sistema inteiro. Use a pasta do projeto.',
      );
    }

    validatePorts(options.ports ?? []);
    this.root = options.root;
    this.type = options.type;
    this.options = options;
    this.sandbox = createSandbox(options);
  }

  /**
   * The policy, as the sandbox enforces it: its filesystem part always and,
   * with `network`, its network part. The network gets only its own rules
   * (`networkRulesOf`): with none, the policy's `default` decides.
   */
  public applyPermissions(
    permissions: AgentPolicy,
    network?: WorkspaceNetworkOptions,
  ): void {
    this.sandbox.configureFilesystem(
      compileFilesystemAccess(permissions, this.root),
    );
    if (network === undefined) return;

    this.configureNetwork(
      new NetworkBoundary({ rules: networkRulesOf(permissions), ...network }),
    );
  }

  /** Network only through `boundary`: the sandbox gets none of its own. */
  public configureNetwork(boundary: NetworkBoundary): void {
    if (this.sandbox.isolateNetwork === undefined) {
      throw new UsageError(
        `O workspace ${this.type} não aplica a categoria network: tire essas regras do agente.`,
      );
    }

    boundary.publish(this.options.ports ?? []);
    this.sandbox.isolateNetwork(boundary);
    this.network = boundary;
  }

  /** See {@link Sandbox.useHost}; sandboxes without it get the whole host share. */
  public useHost(host: SandboxHost): void {
    this.sandbox.useHost?.(host);
  }

  /** See {@link Sandbox.protect}. */
  public protect(paths: readonly string[]): void {
    this.sandbox.protect(paths);
  }

  public prepare(
    command: ProgramCommand,
  ): ProgramCommand | Promise<ProgramCommand> {
    return this.sandbox.prepare({
      ...command,
      cwd: this.root,
    });
  }

  public async close(): Promise<void> {
    await this.sandbox.close?.();
    await this.network?.close();
  }
}

function createSandbox(options: WorkspaceOptions): Sandbox {
  return options.type === 'docker'
    ? new DockerSandbox(options)
    : new BubblewrapSandbox(options);
}
