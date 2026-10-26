/**
 * Lists commands the execution gate denied and lets you select and approve
 * them, in the style of `git add -i`. The running agent continues by itself;
 * a stopped one resumes the interrupted task on its next run. Inside a
 * running agent, Ctrl+A opens the same screen.
 *
 *   bun run approvals [--root <dir>]
 */

import { ApprovalReview } from '../approval/review';
import { defineCommand, runCommand } from '../command/index';
import { getConfig } from '../config/index';
import { Store } from '../store/index';
import { resolve } from '../filesystem/index';

await runCommand(
  defineCommand({
    name: 'run approvals',
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
);
