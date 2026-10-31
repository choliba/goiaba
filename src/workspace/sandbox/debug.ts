import type { ProgramCommand } from '../../execute/types';
import { log } from '../../logger/index';

export function logSandbox(
  sandbox: string,
  command: ProgramCommand,
  extra: Record<string, unknown> = {},
): void {
  log.debug({
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
