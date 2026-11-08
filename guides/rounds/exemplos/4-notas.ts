/**
 * Exemplo 4 do curso de rounds: as notas. A mesma rodada roda três vezes
 * (`repeat: 3`), cada execução com o seu registro. A rubrica (`scoreRound`)
 * avalia cada uma contra as anteriores: a primeira não tem referência de
 * tempo e tokens; a segunda gasta menos tokens que a primeira; a terceira,
 * muito mais. O provider é de mentira (a "CLI" é o próprio bun) e informa
 * os tokens de cada execução, como uma CLI de verdade informa os dela.
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
  scoreRound,
  validateRound,
  type RoundRecord,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Cria index.html e informa `tokens[n]` tokens lidos na n-ésima execução. */
class CountingProvider implements Provider<string, string> {
  public readonly id = 'contador';
  private runs = 0;

  public constructor(private readonly tokens: readonly number[]) {}

  public describe(): { name: string; model: string } {
    return { name: 'contador', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "require('fs').writeFileSync('index.html', '<h1>Olá</h1>\\n'); process.stdout.write('Pronto.')",
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let text = '';
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') text += chunk;
    }
    const input = this.tokens[this.runs] ?? 0;
    this.runs += 1;
    yield {
      type: 'usage',
      usage: { input, output: 100, cachedInput: 0, cacheWrite: 0 },
    };
    yield { type: 'output', value: text };
  }
}

const project = resolve(import.meta.dir, '../../..');
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const roundsDir = join(scratch, 'rodadas');
const records = join(scratch, 'registros');
ensureDirectory(roundsDir);
ensureDirectory(records);

const id = 'tres-vezes';

await runScript(async () => {
  try {
    const files = await runRound(
      defineRound({
        id,
        goal: 'O agente cria o index.html.',
        start: { fixture: 'site-vazio' },
        actors: {
          dev: {
            provider: new CountingProvider([1000, 700, 3000]),
            workspace: { type: 'bubblewrap', root: join(roundsDir, id) },
          },
        },
        flow: [{ actor: 'dev', prompt: () => ['Crie um index.html.'] }],
        // Sem um critério conferível, não há eficácia, e sem ela, nota final.
        criteria: { dev: [{ file: { name: 'index.html', exists: true } }] },
        repeat: 3,
      }),
      { dir: records, project, roundsDir },
    );

    const history: RoundRecord[] = [];
    const lines = [''];
    for (const file of files) {
      const record = validateRound(JSON.parse(readText(file)));
      const score = scoreRound(record, history);
      const dev = score.actors['dev'];
      lines.push(
        `execução ${String(history.length + 1)}: nota ${String(dev.final)} · eficácia ${String(dev.effectiveness.score)} · eficiência ${String(dev.efficiency.score)}`,
      );
      for (const criterion of [
        ...dev.effectiveness.criteria,
        ...dev.efficiency.criteria,
      ]) {
        lines.push(
          `  ${criterion.label}: ${criterion.score === null ? '—' : String(criterion.score)} (${criterion.detail})`,
        );
      }
      history.push(record);
    }
    writeOut(`${lines.join('\n')}\n`);
  } finally {
    removePath(scratch);
  }
});
