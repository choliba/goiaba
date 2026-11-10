/**
 * Lists commands the execution gate denied and lets you select and approve
 * them, in the style of `git add -i`. The running agent continues by itself;
 * a stopped one resumes the interrupted task on its next run. Inside a
 * running agent, Ctrl+A opens the same screen.
 *
 *   goiaba approvals [--root <dir>]   (or bun run approvals)
 */

import { ApprovalReview } from '../approval/review';
import { defineCommand, runCommand } from '../command/index';
import { getConfig } from '../config/index';
import { Store } from '../store/index';
import { resolve } from '../filesystem/index';

/** `goiaba approvals`: reviews and approves the commands the gate denied. */
export async function approvalsCommand(
  argv?: readonly string[],
): Promise<void> {
  await runCommand(
    defineCommand({
      program: 'goiaba',
      name: 'approvals',
      description:
        'Lista os comandos negados pelo gate e deixa selecionar e aprovar.',
      options: {
        root: {
          type: 'string',
          value: 'dir',
          description: 'Workspace cujas negações mostrar',
        },
      },
      run: async ({ options, output }) => {
        const store = Store.open(getConfig().databasePath);

        try {
          await new ApprovalReview(store, output).run(
            options.root === undefined ? undefined : resolve(options.root),
          );
        } finally {
          store.close();
        }
      },
    }),
    argv === undefined ? {} : { argv },
  );
}

if (import.meta.main) await approvalsCommand();
