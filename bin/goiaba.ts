#!/usr/bin/env bun
/**
 * The Goiaba's command line, for a project that installed the package:
 *
 *   goiaba rounds <id>      runs a round of rounds.definitions
 *   goiaba rounds:web       serves the rounds' pages
 *   goiaba approvals        reviews the commands the gate denied
 *
 * Each command reads the project's goiaba.config.ts, from the current
 * folder up.
 */

import { approvalsCommand } from '../src/cli/approvals';
import { roundsCommand, roundsWebCommand } from '../src/cli/rounds';
import { setExitCode, programArguments } from '../src/execute/process';
import { writeErr, writeOut } from '../src/output/stdio';

const COMMANDS: Readonly<
  Record<
    string,
    {
      readonly run: (argv: readonly string[]) => Promise<void>;
      readonly summary: string;
    }
  >
> = {
  rounds: {
    run: roundsCommand,
    summary: 'roda uma rodada: goiaba rounds <id>',
  },
  'rounds:web': {
    run: roundsWebCommand,
    summary: 'serve as páginas das rodadas',
  },
  approvals: {
    run: approvalsCommand,
    summary: 'revisa e aprova os comandos negados pelo gate',
  },
};

const help = (): string =>
  [
    'Uso: goiaba <comando> [opções]',
    '',
    'Comandos:',
    ...Object.entries(COMMANDS).map(
      ([name, { summary }]) => `  ${name.padEnd(12)} ${summary}`,
    ),
    '',
    'Cada comando aceita --help.',
  ].join('\n');

const argv = programArguments();
const name = argv.at(0);
const rest = argv.slice(1);
const command = name === undefined ? undefined : COMMANDS[name];
if (command !== undefined) {
  await command.run(rest);
} else if (name === undefined || name === '--help' || name === '-h') {
  writeOut(`${help()}\n`);
} else {
  writeErr(`Comando desconhecido: ${name}.\n\n${help()}\n`);
  setExitCode(1);
}
