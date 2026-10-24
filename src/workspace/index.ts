import type { ProgramCommand } from '../execute/types.js';
import { UsageError } from '../errors.js';
import { compileFilesystemAccess, type AgentPermissions } from '../policy/index.js';
import {
  BubblewrapSandbox,
  DockerSandbox,
  type Sandbox,
  UnrestrictedSandbox,
} from './sandbox/index.js';

export type WorkspaceType = 'unrestricted' | 'docker' | 'bubblewrap';

export interface UnrestrictedWorkspaceOptions {
  readonly type: 'unrestricted';
  readonly root: string;
}

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
  | UnrestrictedWorkspaceOptions
  | DockerWorkspaceOptions
  | BubblewrapWorkspaceOptions;

export class Workspace {
  public readonly type: WorkspaceType;
  public readonly root: string;
  public readonly sandbox: Sandbox;

  public constructor(options: WorkspaceOptions) {
    if (options.root.trim().length === 0) {
      throw new UsageError('A raiz do workspace não pode estar vazia.');
    }

    this.root = options.root;
    this.type = options.type;
    this.sandbox = createSandbox(options);
  }

  public applyPermissions(permissions: AgentPermissions): void {
    if (this.type === 'unrestricted' || this.sandbox.configureFilesystem === undefined) {
      throw new UsageError(
        'Permissões exigem um workspace Docker ou Bubblewrap.',
      );
    }

    this.sandbox.configureFilesystem(
      compileFilesystemAccess(permissions, this.root),
    );
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
  switch (options.type) {
    case 'unrestricted':
      return new UnrestrictedSandbox();
    case 'docker':
      return new DockerSandbox(options);
    case 'bubblewrap':
      return new BubblewrapSandbox(options);
  }
}
