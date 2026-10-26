import type { ProgramCommand } from '../execute/types';
import { UsageError } from '../errors';
import { compileFilesystemAccess, type AgentPolicy } from '../policy/index';
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
}

export interface BubblewrapWorkspaceOptions {
  readonly type: 'bubblewrap';
  readonly root: string;
  readonly writable?: readonly string[];
}

export type WorkspaceOptions =
  DockerWorkspaceOptions | BubblewrapWorkspaceOptions;

export class Workspace {
  public readonly type: WorkspaceType;
  public readonly root: string;
  /** As created: type, root, image, writable paths. */
  public readonly options: WorkspaceOptions;
  public readonly sandbox: Sandbox;

  public constructor(options: WorkspaceOptions) {
    if (options.root.trim().length === 0) {
      throw new UsageError('A raiz do workspace não pode estar vazia.');
    }

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
  }
}

function createSandbox(options: WorkspaceOptions): Sandbox {
  return options.type === 'docker'
    ? new DockerSandbox(options)
    : new BubblewrapSandbox(options);
}
