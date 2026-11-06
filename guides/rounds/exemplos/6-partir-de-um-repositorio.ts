/**
 * Exemplo 6 do curso de rounds: partir de um repositório que já existe
 * (`start.git`), como um projeto de verdade, e as travas. Primeiro um
 * repositório próprio com a tag: a rodada volta a ele, sem o que sobrou da
 * última vez. Depois uma pasta sem `.git` próprio, dentro desse
 * repositório: a rodada recusa antes de mexer em qualquer coisa, e o
 * arquivo pendente do repositório em volta continua lá. O provider é de
 * mentira (a "CLI" é o próprio bun).
 */
import { randomUUID } from 'node:crypto';

import { UsageError } from '../../../src/errors';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  environment,
  runProgram,
  runtimeExecutable,
} from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  pathExists,
  readText,
  removePath,
  resolve,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  runRound,
  validateRound,
  type RoundDefinition,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que lista a pasta onde roda. */
class ListProvider implements Provider<string, string> {
  public readonly id = 'lista';

  public describe(): { name: string; model: string } {
    return { name: 'lista', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "process.stdout.write('Vejo: ' + require('fs').readdirSync('.').filter((f) => f !== '.git').join(', '))",
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

const git = (root: string, ...args: string[]): Promise<string> =>
  runProgram(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=dev',
      '-c',
      'user.email=dev@exemplo',
      ...args,
    ],
    { timeoutMs: 30_000 },
  );

const project = resolve(import.meta.dir, '../../..');
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const repo = join(scratch, 'projeto-real');
const records = join(scratch, 'registros');
ensureDirectory(repo);
ensureDirectory(records);

/** Uma rodada que parte de `root`, na `tag`, com um agente que lista a pasta. */
const listing = (root: string): RoundDefinition =>
  defineRound({
    id: 'projeto-real',
    goal: 'O agente vê o projeto como na tag.',
    start: { git: { root, tag: 'rodada-base' } },
    actors: {
      dev: {
        provider: new ListProvider(),
        workspace: { type: 'bubblewrap', root },
      },
    },
    flow: [{ actor: 'dev', prompt: () => ['O que há aqui?'] }],
  });

await runScript(async () => {
  try {
    // Um repositório com um commit e a tag; e uma sobra de uma execução antiga.
    writeText(join(repo, 'app.ts'), 'export const versao = 1;\n');
    await git(repo, 'init', '-q');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'base');
    await git(repo, 'tag', 'rodada-base');
    writeText(join(repo, 'sobra.txt'), 'da última execução\n');

    const [file = ''] = await runRound(listing(repo), {
      dir: records,
      project,
    });
    const record = validateRound(JSON.parse(readText(file)));
    writeOut(
      `\npartida: tag ${String(record.start?.tag)}, fixture ${String(record.start?.fixture)}\n` +
        `disse: ${record.steps[0]?.said.join(' ') ?? ''}\n` +
        `sobra.txt ainda existe? ${pathExists(join(repo, 'sobra.txt')) ? 'sim' : 'não'}\n\n`,
    );

    // Uma pasta sem .git próprio, dentro do repositório: o git subiria até ele.
    const inside = join(repo, 'sem-git');
    ensureDirectory(inside);
    writeText(join(repo, 'pendente.txt'), 'não commitado\n');
    try {
      await runRound(listing(inside), { dir: records, project });
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      writeOut(`recusada: ${error.message.replaceAll(scratch, '…')}\n`);
    }
    writeOut(
      `pendente.txt continua? ${pathExists(join(repo, 'pendente.txt')) ? 'sim' : 'não'}\n`,
    );
  } finally {
    removePath(scratch);
  }
});
