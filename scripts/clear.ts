import { defineCommand, runCommand } from '../src/command/index';
import { getConfig } from '../src/config/index';
import {
  listDirectory,
  pathExists,
  removePath,
  join,
} from '../src/filesystem/index';

await runCommand(
  defineCommand({
    name: 'clear',
    description: 'Apaga o conteúdo da pasta do log (logger.dir).',
    options: {
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
      const dir = getConfig().logger.dir;
      const entries = pathExists(dir) ? listDirectory(dir) : [];

      if (entries.length === 0) {
        output.write(`Nada a apagar em ${dir}.`);
        return;
      }

      output.write(
        [`${dir}:`, ...entries.map((name) => `  ${name}`)].join('\n'),
      );
      if (options.dry) return;

      if (!options.yes) {
        output.write(`Apagar ${String(entries.length)} item(ns)? [s/N]`);
        // Waits for Enter: an instant key would leave the Enter in the
        // terminal for the next program to read.
        const answer = await output.ask('', signal);
        if (answer.trim().toLowerCase() !== 's') {
          output.write('Nada foi apagado.');
          return;
        }
      }

      for (const name of entries) removePath(join(dir, name));
      output.write(`${String(entries.length)} item(ns) apagado(s).`);
    },
  }),
);
