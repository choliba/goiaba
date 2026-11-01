import type { ProgramCommand } from '../../execute/types';

export function wrapCommand(
  wrapper: string,
  wrapperArgs: readonly string[],
  command: ProgramCommand,
): ProgramCommand {
  return {
    executable: wrapper,
    arguments: [
      ...wrapperArgs,
      command.executable,
      ...(command.arguments ?? []),
    ],
    ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
    ...(command.input === undefined ? {} : { input: command.input }),
    ...(command.inputStream === undefined
      ? {}
      : { inputStream: command.inputStream }),
  };
}
