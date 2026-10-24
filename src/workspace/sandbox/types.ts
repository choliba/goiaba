import type { ChildProcess } from 'node:child_process';

import type { ProgramCommand } from '../../execute/types.js';
import type { FilesystemAccess } from '../../policy/index.js';

/**
 * Defines how a program command is placed inside an execution boundary.
 * Implementations may wrap it with Docker, Bubblewrap, or another runtime.
 */
export interface Sandbox {
  configureFilesystem?(access: FilesystemAccess): void;
  prepare(command: ProgramCommand): ProgramCommand | Promise<ProgramCommand>;
  started?(process: ChildProcess): void | Promise<void>;
  close?(): void | Promise<void>;
}
