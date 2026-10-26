import type { ProgramCommand } from '../execute/types';
import { UsageError } from '../errors';
import { compileFilesystemAccess, type AgentPolicy } from '../policy/index';
import { validatePorts, type NetworkBoundary } from '../network/index';
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

    validatePorts(options.ports ?? []);
    this.root = options.root;
    this.type = options.type;
    this.options = options;
    this.sandbox = createSandbox(options);
  }

  public applyPermissions(permissions: AgentPolicy): void {
    this.sandbox.configureFilesystem(
      compileFilesystemAccess(permissions, this.root),
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
