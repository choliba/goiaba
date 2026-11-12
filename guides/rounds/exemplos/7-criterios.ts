/**
 * Exemplo 7 do curso de rounds: os critérios. O dev atende o ticket da
 * fixture (trocar o título para Goiaba) e o revisor só lê. A rodada declara
 * critérios dos três tipos (arquivo, limite e condicional), com curinga,
 * `ignore`, `contains`, `matches`, `created` e `changed`; alguns não são
 * cumpridos de propósito, para mostrar o motivo que fica no registro. Depois,
 * a rubrica transforma os vereditos em nota. O provider é de mentira (a
 * "CLI" é o próprio bun): escreve os arquivos que recebeu e responde o texto
 * que recebeu.
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
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que grava `files` (caminho → conteúdo) e responde `answer`. */
class ScriptProvider implements Provider<string, string> {
  public readonly id = 'roteiro';

  public constructor(
    private readonly answer: string,
    private readonly files: Readonly<Record<string, string>> = {},
  ) {}

  public describe(): { name: string; model: string } {
    return { name: 'roteiro', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    const script = [
      "const fs = require('fs');",
      "const path = require('path');",
      `for (const [file, text] of Object.entries(${JSON.stringify(this.files)})) {`,
      '  fs.mkdirSync(path.dirname(file), { recursive: true });',
      '  fs.writeFileSync(file, text);',
      '}',
      `process.stdout.write(${JSON.stringify(this.answer)});`,
    ].join('\n');
    return { executable: runtimeExecutable(), arguments: ['-e', script] };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
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

const id = 'titulo-goiaba';
const root = join(roundsDir, id);
const workspace = { type: 'bubblewrap', root } as const;

await runScript(async () => {
  try {
    const [file = ''] = await runRound(
      defineRound({
        id,
        goal: 'O dev troca o título para Goiaba e anota a mudança; o revisor só lê.',
        start: { fixture: 'site-vazio' },
        actors: {
          dev: {
            provider: new ScriptProvider('Título trocado.', {
              // Reescreve a página inteira: o título mudou, o rodapé sumiu.
              'index.html': '<html><body><h1>🚀 Goiaba</h1></body></html>\n',
              'docs/mudancas.md': '# Mudanças\n\nTítulo trocado para Goiaba.\n',
              'docs/rascunho.tmp': 'rascunho\n',
            }),
            workspace,
          },
          revisor: {
            provider: new ScriptProvider('Está certo.'),
            workspace,
            readOnly: true,
          },
        },
        flow: [
          {
            actor: 'dev',
            prompt: () => [
              'Atenda o ticket.txt, sem apagar o rodapé.',
              'Anote a mudança num arquivo em docs/ e marque o ticket como done.',
            ],
          },
          {
            actor: 'revisor',
            prompt: () => ['Revise a mudança. Não altere nada.'],
          },
        ],
        criteria: {
          dev: [
            // O título mudou: o arquivo mudou, tem a palavra e a tag certa.
            {
              file: {
                name: 'index.html',
                changed: true,
                contains: ['Goiaba'],
                matches: [/<h1>[^<]*Goiaba<\/h1>/],
              },
            },
            // "sem apagar o rodapé"
            { file: { name: 'index.html', contains: ['<footer'] } },
            // "Anote a mudança num arquivo em docs/": todo arquivo de docs/,
            // menos os .tmp, foi criado e fala do Goiaba.
            {
              file: {
                name: 'docs/*',
                ignore: ['docs/*.tmp'],
                created: true,
                contains: ['goiaba'],
              },
            },
            // O que não foi pedido não muda.
            { file: { name: 'README.md', changed: false } },
            // "marque o ticket como done", se ele estava pendente.
            {
              if: { name: 'ticket.txt', contains: ['status: pending'] },
              check: [
                { file: { name: 'ticket.txt', contains: ['status: done'] } },
              ],
            },
            // O que o dev pode gastar. Os tokens este provider não informa.
            { limit: { time: '1min', tokens: 5000 } },
          ],
          revisor: [
            // Se a anotação ainda não existia, ele não fez o trabalho do dev;
            // se já existia (o caso aqui), ele não altera nada, em pasta
            // nenhuma (`**`; `*` só olha a raiz).
            {
              if: { name: 'docs/mudancas.md', exists: false },
              check: [{ file: { name: 'docs/mudancas.md', exists: false } }],
              else: [{ file: { name: '**', changed: false } }],
            },
          ],
          // A rodada inteira.
          round: [{ limit: { time: '10min' } }],
        },
      }),
      { dir: records, project, roundsDir },
    );

    const record = validateRound(JSON.parse(readText(file)));
    const lines = ['', 'No fim de cada passo (step.criteria):'];
    for (const step of record.steps) {
      lines.push(`  ${step.key}`);
      for (const criterion of step.criteria) {
        lines.push(
          `    ${criterion.met ? '✓' : '✗'} ${criterion.description} (${criterion.detail})`,
        );
      }
    }

    const score = scoreRound(record, []);
    lines.push('', 'Na nota (scoreRound):');
    for (const [actor, actorScore] of Object.entries(score.actors)) {
      lines.push(
        `  ${actor}: eficácia ${String(actorScore.effectiveness.score)}`,
      );
      for (const criterion of actorScore.effectiveness.criteria) {
        if (criterion.score === null) continue;
        lines.push(
          `    ${criterion.label}: ${String(criterion.score)} (${criterion.detail})`,
        );
      }
    }
    lines.push(`  rodada: eficácia ${String(score.round.effectiveness.score)}`);
    for (const criterion of score.round.effectiveness.criteria) {
      lines.push(
        `    ${criterion.label}: ${String(criterion.score)} (${criterion.detail})`,
      );
    }
    writeOut(`${lines.join('\n')}\n`);
  } finally {
    removePath(scratch);
  }
});
