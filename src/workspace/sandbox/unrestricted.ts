import type { ChildProcess } from 'node:child_process';

import type { ProgramCommand } from '../../execute/types.js';
import { debug, isDebug } from '../../log/index.js';
import { logSandbox } from './debug.js';
import type { Sandbox } from './types.js';

/**
 * Preserves the current behavior by executing the command without isolation.
 */
export class UnrestrictedSandbox implements Sandbox {
  public prepare(command: ProgramCommand): ProgramCommand {
    logSandbox('unrestricted', command, {
      isolation: false,
      network: { mode: 'host' },
      mounts: [],
      volumes: [],
    });
    return command;
  }

  public started(process: ChildProcess): void {
    if (!isDebug()) {
      return;
    }

    debug({
      type: 'sandbox',
      sandbox: 'unrestricted',
      phase: 'process',
      pid: process.pid,
    });
  }
}
