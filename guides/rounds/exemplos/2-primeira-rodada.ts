/**
 * Exemplo 2 do curso de rounds: a primeira rodada. Um agente parte da
 * fixture `site-vazio` (rounds/fixtures), numa pasta só dele fora do
 * projeto, escreve um arquivo e responde. O registro sai num arquivo JSON,
 * e o exemplo mostra o que ele guardou. O provider é de mentira (a "CLI" é o
 * próprio bun), para rodar sem modelo nem rede.
 */
import { randomUUID } from 'node:crypto';

import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
  resolve,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  runRound,
  validateRound,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que cria index.html na pasta onde roda e diz o que fez. */
class SiteProvider implements Provider<string, string> {
  public readonly id = 'site';

  public describe(): { name: string; model: string } {
    return { name: 'site', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "require('fs').writeFileSync('index.html', '<h1>Olá</h1>\\n'); process.stdout.write('Criei o index.html.')",
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

/** O Goiaba: onde ficam as fixtures (rounds/fixtures). */
const project = resolve(import.meta.dir, '../../..');
// Fora do projeto, como o rounds.dir exige; e um lugar só para os registros.
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const roundsDir = join(scratch, 'rodadas');
const records = join(scratch, 'registros');
ensureDirectory(roundsDir);
ensureDirectory(records);

const id = 'primeira-rodada';
const root = join(roundsDir, id);

await runScript(async () => {
  try {
    const [file = ''] = await runRound(
      defineRound({
        id,
        goal: 'O agente cria o index.html.',
        start: { fixture: 'site-vazio' },
        actors: {
          dev: {
            provider: new SiteProvider(),
            workspace: { type: 'bubblewrap', root },
          },
        },
        flow: [{ actor: 'dev', prompt: () => ['Crie um index.html.'] }],
      }),
      { dir: records, project, roundsDir },
    );

    const record = validateRound(JSON.parse(readText(file)));
    const step = record.steps[0];
    writeOut(
      [
        '',
        `registro: ${file.slice(scratch.length + 1)}`,
        `partida: fixture ${String(record.start?.fixture)}, tag ${String(record.start?.tag)}`,
        `passo: ${step.key}`,
        `pedido: ${step.prompt.text}`,
        `disse: ${step.said.join(' ')}`,
        `alterou: ${step.changed.join(', ')}`,
        '',
      ].join('\n'),
    );
  } finally {
    removePath(scratch);
  }
});
