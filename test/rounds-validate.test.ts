import { expect, test } from 'bun:test';

import { UsageError } from '../src/errors';
import {
  ROUND_SCHEMA,
  validateRound,
  type RoundRecord,
} from '../src/rounds/index';

const span = (startedAt: string, endedAt: string) => ({
  startedAt,
  endedAt,
  durationMs: Date.parse(endedAt) - Date.parse(startedAt),
});

const noTokens = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
};

/** A small valid round: one agent, one step, two requests to the model. */
function round(): RoundRecord {
  return {
    schema: ROUND_SCHEMA,
    id: '2026-11-04T10-00-00.000Z',
    definition: { id: 'analise', goal: 'O analista não altera arquivos' },
    start: { tag: 'rodada-base', commit: '33125e6' },
    repeat: { index: 1, total: 2 },
    timing: {
      ...span('2026-11-04T10:00:00.000Z', '2026-11-04T10:01:00.000Z'),
      actors: {
        analista: {
          ...span('2026-11-04T10:00:01.000Z', '2026-11-04T10:00:59.000Z'),
          workspaceMs: 1200,
          gitCheckMs: 300,
          approvalMs: null,
        },
      },
    },
    actors: {
      analista: {
        role: 'analista',
        provider: {
          id: 'claude',
          name: 'claude',
          model: 'claude-opus-5-5',
          cli: null,
          cliVersion: '3.1.0',
          options: { model: 'claude-opus-5-5' },
        },
        workspace: {
          type: 'docker',
          image: 'FROM busybox:latest',
          root: '<projeto>/storage/workspaces',
          writable: [],
          hostState: 'none',
          ports: [],
        },
        network: {
          rules: { default: 'deny', allow: [], requireApproval: [], deny: [] },
          alwaysAllow: ['api.anthropic.com:443'],
          alwaysDeny: [],
          decisions: [
            {
              ts: '2026-11-04T10:00:02.000Z',
              destination: 'api.anthropic.com:443',
              protocol: 'https',
              decision: 'allow',
              decidedBy: 'provider',
              reason: 'API do modelo',
            },
          ],
        },
        policy: { default: 'deny' },
        readOnly: true,
        configHash: 'a1',
      },
    },
    configHash: 'b2',
    steps: [
      {
        key: 'analista#1',
        actor: 'analista',
        by: null,
        prompt: { text: 'Analise o projeto.', hash: 'c3' },
        span: span('2026-11-04T10:00:01.000Z', '2026-11-04T10:00:59.000Z'),
        said: ['Nenhum problema.'],
        asked: [],
        turns: [
          {
            index: 1,
            span: span('2026-11-04T10:00:02.000Z', '2026-11-04T10:00:58.000Z'),
          },
        ],
        tools: [
          {
            turn: 1,
            name: 'Bash',
            detail: { command: 'npm test' },
            outcome: 'result',
            span: span('2026-11-04T10:00:10.000Z', '2026-11-04T10:00:20.000Z'),
          },
        ],
        changed: [],
        diff: '',
        instructions: [
          {
            check: 'tickets/ticket-01.txt contém "ANÁLISE TÉCNICA"',
            when: { check: 'tickets/ticket-01.txt existe', held: true },
            met: true,
            detail: 'tickets/ticket-01.txt contém "ANÁLISE TÉCNICA".',
          },
        ],
        totals: {
          tokens: { ...noTokens, input: 2200, output: 130, cacheRead: 900 },
          fresh: 1430,
          costUsd: 0.03,
        },
        references: { cited: 1, valid: 1, invalid: [] },
      },
    ],
    usage: [
      {
        ts: '2026-11-04T10:00:10.000Z',
        actor: 'analista',
        step: 0,
        turn: 1,
        action: 'Bash',
        tokens: { ...noTokens, input: 1000, output: 50 },
        costUsd: 0.01,
        costSource: 'cli',
      },
      {
        ts: '2026-11-04T10:00:58.000Z',
        actor: 'analista',
        step: 0,
        turn: 1,
        action: null,
        tokens: { ...noTokens, input: 1200, output: 80, cacheRead: 900 },
        costUsd: 0.02,
        costSource: 'cli',
      },
    ],
    totals: {
      round: {
        tokens: { ...noTokens, input: 2200, output: 130, cacheRead: 900 },
        fresh: 1430,
        costUsd: 0.03,
      },
      actors: {
        analista: {
          tokens: { ...noTokens, input: 2200, output: 130, cacheRead: 900 },
          fresh: 1430,
          costUsd: 0.03,
        },
      },
    },
    measures: {
      analista: {
        turns: 1,
        tools: 1,
        questions: 0,
        changedFiles: 0,
        tests: { passed: true, command: 'npm test', summary: '5 de 5' },
        typecheck: null,
      },
    },
    violations: [
      {
        rule: 'read-only-respected',
        actor: 'analista',
        passed: true,
        detail: 'O git não mostra nenhuma alteração.',
      },
    ],
  };
}

/** Objects and lists, indexed by key or position. */
const isNode = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The object at `path` inside `value`. */
function at(
  value: unknown,
  ...path: (string | number)[]
): Record<string, unknown> {
  let node = value;
  for (const key of path) {
    if (!isNode(node)) throw new Error(`nada em ${String(key)}`);
    node = node[String(key)];
  }
  if (!isNode(node)) throw new Error(`nada em ${path.join('.')}`);
  return node;
}

/** A copy of the valid round with `change` applied to it. */
function changed(change: (value: Record<string, unknown>) => void): unknown {
  const value = at(structuredClone(round()));
  change(value);
  return value;
}

test('aceita uma rodada válida e a devolve', () => {
  const value = round();
  expect(validateRound(value)).toBe(value);
});

test('aceita uma rodada com o que não foi medido como null, e sem objetivo', () => {
  const value = changed((r) => {
    // agents/02.ts ran before declarations had a goal.
    at(r, 'definition')['goal'] = '';
    for (const index of [0, 1]) {
      at(r, 'usage', index)['costUsd'] = null;
      at(r, 'usage', index)['costSource'] = null;
    }
    at(r, 'steps', 0, 'totals')['costUsd'] = null;
    at(r, 'totals', 'round')['costUsd'] = null;
    at(r, 'totals', 'actors', 'analista')['costUsd'] = null;
  });
  expect(() => validateRound(value)).not.toThrow();
});

test.each([
  [
    'outro schema',
    (r: Record<string, unknown>) => {
      r['schema'] = 1;
    },
    '$.schema: esperava 4, veio 1',
  ],
  [
    'campo obrigatório faltando',
    (r: Record<string, unknown>) => {
      delete at(r, 'actors', 'analista')['network'];
    },
    '$.actors.analista.network: campo obrigatório',
  ],
  [
    'campo desconhecido',
    (r: Record<string, unknown>) => {
      at(r, 'steps', 0)['nota'] = 5;
    },
    '$.steps[0].nota: campo desconhecido',
  ],
  [
    'tipo errado no fundo',
    (r: Record<string, unknown>) => {
      at(r, 'steps', 0, 'tools', 0, 'span')['durationMs'] = -1;
    },
    '$.steps[0].tools[0].span.durationMs: esperava um inteiro >= 0, veio -1',
  ],
  [
    'valor fora da lista',
    (r: Record<string, unknown>) => {
      at(r, 'actors', 'analista', 'workspace')['type'] = 'vm';
    },
    '$.actors.analista.workspace.type: esperava docker | bubblewrap, veio "vm"',
  ],
  [
    'data que não é data',
    (r: Record<string, unknown>) => {
      at(r, 'timing')['startedAt'] = 'ontem';
    },
    '$.timing.startedAt: esperava uma data ISO, veio "ontem"',
  ],
  [
    'agente que não está em actors',
    (r: Record<string, unknown>) => {
      at(r, 'steps', 0)['by'] = 'programador';
    },
    'steps[0].by: "programador" não está em actors',
  ],
  [
    'total que não é a soma de usage',
    (r: Record<string, unknown>) => {
      at(r, 'totals', 'actors', 'analista', 'tokens')['output'] = 999;
    },
    'totals.actors.analista.tokens.output: 999, mas a soma de usage é 130',
  ],
  [
    'total que não é a soma do que foi medido',
    (r: Record<string, unknown>) => {
      at(r, 'usage', 0, 'tokens')['reasoning'] = null;
      at(r, 'usage', 1, 'tokens')['reasoning'] = null;
    },
    'steps[0].totals.tokens.reasoning: 0, mas a soma de usage é null',
  ],
  [
    'registro de tokens num passo de outro agente',
    (r: Record<string, unknown>) => {
      at(r, 'usage', 0)['actor'] = 'revisor';
    },
    'usage[0].actor: "revisor" não está em actors',
  ],
  [
    'chave de passo errada',
    (r: Record<string, unknown>) => {
      at(r, 'steps', 0)['key'] = 'analista#2';
    },
    'steps[0].key: "analista#2", mas é o passo 1 de analista (analista#1)',
  ],
  [
    'tokens novos que não batem',
    (r: Record<string, unknown>) => {
      at(r, 'totals', 'round')['fresh'] = 1;
    },
    'totals.round.fresh: 1, mas os tokens novos de usage somam 1430',
  ],
])('recusa %s, dizendo onde', (_name, change, message) => {
  const value = changed(change);
  expect(() => validateRound(value, 'r.json')).toThrow(UsageError);
  expect(() => validateRound(value, 'r.json')).toThrow(
    `r.json não é uma rodada válida: ${message}`,
  );
});

test('recusa o que nem é um objeto', () => {
  expect(() => validateRound([])).toThrow(
    'rodada não é uma rodada válida: $: esperava um objeto, veio uma lista',
  );
});
