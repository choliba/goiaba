import type { ProgramCommand } from '../../execute/types';
import { reportDebug } from '../../output/activity';

export function logSandbox(
  sandbox: string,
  command: ProgramCommand,
  extra: Record<string, unknown> = {},
): void {
  reportDebug({
    type: 'sandbox',
    sandbox,
    command: {
      executable: command.executable,
      arguments: command.arguments ?? [],
      cwd: command.cwd,
    },
    ...extra,
  });
}
