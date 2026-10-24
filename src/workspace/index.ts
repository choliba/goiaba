import type { ProgramCommand } from '../execute/types.js';
import { type Sandbox, UnrestrictedSandbox } from './sandbox/index.js';

export type WorkspaceType = 'unrestricted';

export interface WorkspaceOptions {
  readonly type: WorkspaceType;
  readonly root: string;
}

export class Workspace {
  public readonly root: string;
  public readonly sandbox: Sandbox;

  public constructor({ type, root }: WorkspaceOptions) {
    if (root.trim().length === 0) {
      throw new Error('A raiz do workspace não pode estar vazia.');
    }

    this.root = root;
    this.sandbox = createSandbox(type);
  }

  public prepare(
    command: ProgramCommand,
  ): ProgramCommand | Promise<ProgramCommand> {
    return this.sandbox.prepare({
      ...command,
      cwd: this.root,
    });
  }
}

function createSandbox(type: WorkspaceType): Sandbox {
  switch (type) {
    case 'unrestricted':
      return new UnrestrictedSandbox();
  }
}
