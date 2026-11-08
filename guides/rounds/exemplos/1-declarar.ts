/**
 * Exemplo 1 do curso de rounds: declarar uma rodada. `defineRound` confere
 * a declaração antes de qualquer agente rodar: uma declaração certa volta
 * como veio; uma errada é um UsageError que diz o que corrigir. Não roda
 * nada: só confere.
 */
import { UsageError } from '../../../src/errors';
import { writeOut } from '../../../src/output/stdio';
import type { Provider } from '../../../src/providers/types';
import {
  defineRound,
  noQuestions,
  type RoundDefinition,
} from '../../../src/rounds/index';

/** Um provider que nunca roda: aqui só a declaração é conferida. */
const provider: Provider<string, string> = {
  id: 'nenhum',
  createCommand: () => ({ executable: 'true', arguments: [] }),
  parseOutput: async function* () {},
};

/** Uma declaração certa: um agente, um passo, uma regra. */
const base: RoundDefinition = {
  id: 'so-analise',
  goal: 'O analista aponta os problemas sem alterar nada.',
  start: { fixture: 'site-vazio' },
  actors: {
    analista: {
      provider,
      workspace: { type: 'bubblewrap', root: '/tmp/rodadas/so-analise' },
      readOnly: true,
    },
  },
  flow: [{ actor: 'analista', prompt: () => ['Analise o projeto.'] }],
  rules: [noQuestions()],
};

const ok = defineRound(base);
writeOut(`certa: ${ok.id}, ${String(ok.flow.length)} passo(s)\n\n`);

/** Cada uma com um erro só, e a mensagem que ele dá. */
const wrong: [string, RoundDefinition][] = [
  ['id com maiúsculas', { ...base, id: 'So-Analise' }],
  ['sem objetivo', { ...base, goal: ' ' }],
  [
    'passo de quem não está em actors',
    { ...base, flow: [{ actor: 'revisor', prompt: () => [] }] },
  ],
  [
    'fixture que não é um nome de pasta',
    { ...base, start: { fixture: '../fora' } },
  ],
  [
    'otherwise sem when',
    {
      ...base,
      criteria: {
        analista: [{ file: { name: 'a.txt', exists: true } }],
      },
    },
  ],
  ['repeat zero', { ...base, repeat: 0 }],
];

for (const [label, definition] of wrong) {
  try {
    defineRound(definition);
    writeOut(`${label}: aceita\n`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    writeOut(`${label}:\n  ${error.message}\n`);
  }
}
