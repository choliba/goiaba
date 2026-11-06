/**
 * Exemplo 3 do curso de rounds: dois agentes, instruções e regras. O
 * product owner escreve um ticket; o analista recebe o que ele disse, mas,
 * mesmo com `readOnly`, grava um arquivo. A rodada confere sozinha as
 * instruções de cada um (o arquivo existe? tem o trecho? não alterou nada?)
 * e as regras, e o exemplo mostra os vereditos que ficaram no registro. O
 * provider é de mentira (a "CLI" é o próprio bun): escreve os arquivos que
 * recebeu e responde o texto que recebeu.
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
  noQuestions,
  readOnlyRespected,
  runRound,
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

const id = 'ticket-e-analise';
const root = join(roundsDir, id);
const workspace = { type: 'bubblewrap', root } as const;

await runScript(async () => {
  try {
    const [file = ''] = await runRound(
      defineRound({
        id,
        goal: 'O product owner escreve o ticket e o analista só lê.',
        start: { fixture: 'site-vazio' },
        actors: {
          'product-owner': {
            provider: new ScriptProvider('O ticket está pronto.', {
              'tickets/ticket-01.txt': 'Implementar um rodapé vazio.\n',
            }),
            workspace,
          },
          analista: {
            provider: new ScriptProvider('Basta um <footer></footer>.', {
              'notas.txt': 'rascunho\n',
            }),
            workspace,
            readOnly: true,
          },
        },
        flow: [
          {
            actor: 'product-owner',
            prompt: () => ['Escreva o ticket em tickets/ticket-01.txt.'],
          },
          {
            actor: 'analista',
            by: 'product-owner',
            prompt: ({ said }) => [
              'Leia o ticket e diga como implementar. Não altere nada.',
              `O product owner disse: ${said['product-owner'] ?? ''}`,
            ],
          },
        ],
        instructions: {
          // "Escreva o ticket em tickets/ticket-01.txt."
          'product-owner': [
            { check: { file: 'tickets/ticket-01.txt', contains: 'rodapé' } },
          ],
          // "Não altere nada", se o ticket estava lá quando ele começou.
          analista: [
            {
              when: { file: 'tickets/ticket-01.txt' },
              check: { unchanged: true },
            },
          ],
        },
        rules: [readOnlyRespected(), noQuestions()],
      }),
      { dir: records, project, roundsDir },
    );

    const record = validateRound(JSON.parse(readText(file)));
    const lines = [''];
    for (const step of record.steps) {
      lines.push(
        step.key,
        `  pedido: ${step.prompt.text.replace(/\n/g, ' / ')}`,
      );
      for (const instruction of step.instructions) {
        lines.push(
          `  instrução: ${instruction.check} → ${instruction.met ? 'cumpriu' : 'não cumpriu'} (${instruction.detail})`,
        );
      }
    }
    lines.push('regras:');
    for (const result of record.violations) {
      lines.push(
        `  ${result.rule} · ${result.actor}: ${result.passed ? 'cumpriu' : 'violou'} (${result.detail})`,
      );
    }
    writeOut(`${lines.join('\n')}\n`);
  } finally {
    removePath(scratch);
  }
});
