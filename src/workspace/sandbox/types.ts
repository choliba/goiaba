import type { ProgramCommand } from '../../execute/types';
import type { FilesystemAccess } from '../../policy/index';

/**
 * Defines how a program command is placed inside an execution boundary.
 * Implementations may wrap it with Docker, Bubblewrap, or another runtime.
 */
export interface Sandbox {
  configureFilesystem(access: FilesystemAccess): void;
  /**
   * Mounts paths outside the workspace read-only on top of the writable ones
   * (e.g. the execution gate's hook inside `~/.cache`), so the agent cannot
   * rewrite what enforces its own policy.
   */
  protect(paths: readonly string[]): void;
  prepare(command: ProgramCommand): ProgramCommand | Promise<ProgramCommand>;
  /** The agent's CLI started inside the sandbox (for debug logging). */
  started?(pid: number | undefined): void | Promise<void>;
  close?(): void | Promise<void>;
}
