import type { ProgramCommand } from '../../execute/types.js';

export function wrapCommand(
  wrapper: string,
  wrapperArgs: readonly string[],
  command: ProgramCommand,
): ProgramCommand {
  return {
    executable: wrapper,
    arguments: [...wrapperArgs, command.executable, ...(command.arguments ?? [])],
    cwd: command.cwd,
    input: command.input,
  };
}
