import type { ProgramCommand } from '../../execute/types.js';

/**
 * Defines how a program command is placed inside an execution boundary.
 * Implementations may wrap it with Docker, Bubblewrap, or another runtime.
 */
export interface Sandbox {
  prepare(command: ProgramCommand): ProgramCommand | Promise<ProgramCommand>;
}

/**
 * Preserves the current behavior by executing the command without isolation.
 */
export class UnrestrictedSandbox implements Sandbox {
  public prepare(command: ProgramCommand): ProgramCommand {
    return command;
  }
}
