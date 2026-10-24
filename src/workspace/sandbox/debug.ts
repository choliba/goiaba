import type { ProgramCommand } from '../../execute/types.js';
import { debug } from '../../log/index.js';

export function logSandbox(
  sandbox: string,
  command: ProgramCommand,
  extra: Record<string, unknown> = {},
): void {
  debug({
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
