import { defineCommand, runCommand } from '../src/command/index';
import { getConfig } from '../src/config/index';
import { UsageError } from '../src/errors';
import {
  listDirectory,
  pathExists,
  removePath,
  join,
} from '../src/filesystem/index';

await runCommand(
  defineCommand({
    name: 'clear',
    description:
      'Apaga o conteúdo das pastas do Goiaba: logs (logger.dir), workspaces (workspaces.dir) e homes (workspaces.homes).',
    options: {
      all: {
        type: 'boolean',
        short: 'a',
        description: 'Apaga logs, workspaces e homes',
      },
      logs: {
        type: 'boolean',
        short: 'l',
        description: 'Apaga os logs (logger.dir)',
      },
      workspaces: {
        type: 'boolean',
        short: 'w',
        description: 'Apaga os workspaces (workspaces.dir)',
      },
      homes: {
        type: 'boolean',
        short: 'H',
        description: 'Apaga os homes dos workspaces (workspaces.homes)',
      },
      dry: {
        type: 'boolean',
        short: 'd',
        description: 'Lista o que seria apagado, sem apagar',
      },
      yes: {
        type: 'boolean',
        short: 'y',
        description: 'Apaga sem perguntar',
      },
    },
    run: async ({ options, output, signal }) => {
      const config = getConfig();
      const chosen = [
        options.all || options.logs ? config.logger.dir : undefined,
        options.all || options.workspaces ? config.workspaces.dir : undefined,
        options.all || options.homes ? config.workspaces.homes : undefined,
      ].filter((dir) => dir !== undefined);

      if (chosen.length === 0) {
        throw new UsageError(
          'Diga o que apagar: --logs, --workspaces, --homes ou --all.',
        );
      }

      // Two options may point at the same folder: it is listed once.
      const dirs = [...new Set(chosen)];
      const found = dirs
        .map((dir) => ({
          dir,
          entries: pathExists(dir) ? listDirectory(dir) : [],
        }))
        .filter(({ entries }) => entries.length > 0);

      if (found.length === 0) {
        output.write(`Nada a apagar em ${dirs.join(', ')}.`);
        return;
      }

      output.write(
        found
          .map(({ dir, entries }) =>
            [`${dir}:`, ...entries.map((name) => `  ${name}`)].join('\n'),
          )
          .join('\n'),
      );
      if (options.dry) return;

      if (!options.yes) {
        const total = found.reduce(
          (sum, { entries }) => sum + entries.length,
          0,
        );
        output.write(`Apagar ${String(total)} item(ns)? [s/N]`);
        // Waits for Enter: an instant key would leave the Enter in the
        // terminal for the next program to read.
        const answer = await output.ask('', signal);
        if (answer.trim().toLowerCase() !== 's') {
          output.write('Nada foi apagado.');
          return;
        }
      }

      // Listed again: this run's own log may have been made since (the
      // answer above is logged), and it goes too.
      let removed = 0;
      for (const { dir } of found) {
        for (const name of listDirectory(dir)) {
          removePath(join(dir, name));
          removed += 1;
        }
      }
      output.write(`${String(removed)} item(ns) apagado(s).`);
    },
  }),
);
