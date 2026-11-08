import { expect, test } from 'bun:test';

import { checkReferences, parseReferences } from '../src/rounds/references';
import { ratioScore, RUBRIC_VERSION, scoreRound } from '../src/rounds/score';
import { freshOf } from '../src/rounds/totals';
import type { RoundRecord, RoundStep, UsageRecord } from '../src/rounds/types';

const span = {
  startedAt: '2026-11-05T10:00:00.000Z',
  endedAt: '2026-11-05T10:00:30.000Z',
  durationMs: 30_000,
};
const none = {
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
  reasoning: null,
};

function step(
  actor: string,
  said: string[],
  extra: Partial<RoundStep> = {},
): RoundStep {
  return {
    key: `${actor}#1`,
    actor,
    by: null,
    prompt: { text: 'x', hash: 'h' },
    span,
    said,
    asked: [],
    turns: [],
    tools: [],
    changed: [],
    diff: '',
    instructions: [],
    totals: { tokens: none, fresh: null, costUsd: null },
    references: null,
    ...extra,
  };
}

/** A round of one analyst, with what it said, its time and its new tokens. */
function round(
  said: string[],
  ms: number,
  fresh: number | null,
  extra: Partial<RoundRecord> = {},
): RoundRecord {
  return {
    schema: 4,
    id: 'r',
    definition: { id: 'teste', goal: 'g' },
    start: null,
    repeat: { index: 1, total: 1 },
    timing: {
      ...span,
      actors: {
        analista: {
          ...span,
          durationMs: ms,
          workspaceMs: null,
          gitCheckMs: null,
          approvalMs: null,
        },
      },
    },
    actors: {
      analista: {
        role: 'analista',
        provider: {
          id: 'p',
          name: 'p',
          model: 'm',
          cli: null,
          cliVersion: null,
          options: {},
        },
        workspace: {
          type: 'docker',
          image: null,
          root: '<projeto>',
          writable: [],
          hostState: 'none',
          ports: [],
        },
        network: {
          rules: null,
          alwaysAllow: [],
          alwaysDeny: [],
          decisions: [],
        },
        policy: null,
        readOnly: false,
        configHash: 'a',
      },
    },
    configHash: 'c',
    steps: [step('analista', said)],
    usage: [],
    totals: {
      round: { tokens: none, fresh, costUsd: null },
      actors: { analista: { tokens: none, fresh, costUsd: null } },
    },
    measures: {},
    violations: [],
    ...extra,
  };
}

test('referências: acha arquivo:linha e intervalos, sem repetir', () => {
  expect(
    parseReferences(
      'Em `src/usuarios.ts:8-12` e package.json:13; de novo src/usuarios.ts:8-12. Não: v1.2:3x? sim: a.b:3',
    ).map((r) => [r.text, r.path, r.line]),
  ).toEqual([
    ['src/usuarios.ts:8-12', 'src/usuarios.ts', 12],
    ['package.json:13', 'package.json', 13],
    ['v1.2:3', 'v1.2', 3],
    ['a.b:3', 'a.b', 3],
  ]);
});

test('referências: confere a existência do arquivo e da linha', async () => {
  const lines: Record<string, number> = { 'src/a.ts': 10 };
  const checked = await checkReferences(
    'src/a.ts:3, src/a.ts:11 e src/b.ts:1',
    (path) => Promise.resolve(lines[path]),
  );
  expect(checked).toEqual({
    cited: 3,
    valid: 1,
    invalid: ['src/a.ts:11', 'src/b.ts:1'],
  });
});

/** A usage record with these tokens. */
const usage = (tokens: Partial<UsageRecord['tokens']>): UsageRecord => ({
  ts: '',
  actor: 'a',
  step: 0,
  turn: 1,
  action: null,
  costUsd: null,
  costSource: null,
  tokens: { ...none, ...tokens },
});

test('tokens novos: o que foi lido fora do cache, mais o que foi escrito', () => {
  expect(freshOf(usage({ input: 1000, cacheRead: 900, output: 50 }))).toBe(150);
  expect(freshOf(usage({}))).toBeNull();
});

test('nota de recurso: 5 até 75% da referência, 3 nela, 0 no dobro', () => {
  expect(
    [0.5, 0.75, 0.875, 1, 1.5, 2, 3].map((r) => ratioScore(r * 100, 100)),
  ).toEqual([5, 5, 4, 3, 1.5, 0, 0]);
});

const result = (met: boolean, check = 'tickets/ticket-01.txt existe') => ({
  check,
  when: null,
  met,
  detail: met ? 'ok.' : 'faltou.',
});
test('eficácia pelas instruções do prompt, e eficiência escalada por ela', () => {
  const history = [round(['x'], 20_000, 1000), round(['x'], 40_000, 3000)];
  const current = round(['feito'], 30_000, 2000, {
    steps: [
      step('analista', ['feito'], {
        instructions: [
          result(true),
          result(true, 'tickets/ticket-01.txt contém "ANÁLISE TÉCNICA"'),
          result(false, 'tickets/ticket-01.txt contém "testes"'),
        ],
      }),
    ],
  });
  const score = scoreRound(current, history);
  const analista = score.actors['analista'];

  expect(score.version).toBe(RUBRIC_VERSION);
  // 2 of 3 instructions met: 3,3.
  expect(analista.effectiveness.score).toBe(3.3);
  expect(analista.effectiveness.criteria[0]?.detail).toBe(
    'Cumpriu 2 de 3. faltou.',
  );
  // Time and tokens at the median (3 each), no waste (5): base 4; × 3,3/5.
  expect(analista.efficiency.base).toBe(4);
  expect(analista.efficiency.score).toBe(2.6);
  // Final: 60% × 3,3 + 40% × 4 (the base, not the scaled 2,6).
  expect(analista.final).toBe(3.6);
  expect(score.round.final).toBe(3.6);
});

/** The Permissões criterion of the analyst. */
const permissionsOf = (record: RoundRecord) =>
  scoreRound(record, []).actors['analista'].effectiveness.criteria.find(
    (c) => c.id === 'policy',
  );

test('permissões: dentro do que a política libera dá 5; fora dela, 0', () => {
  const policy = {
    default: 'deny' as const,
    allow: {
      filesystem: [
        { operations: ['read' as const], paths: ['/workspace/**'] },
        { operations: ['write' as const], paths: ['/workspace/tickets/**'] },
      ],
    },
  };
  const withChange = (changed: string[]): RoundRecord => {
    const base = round(['ok'], 30_000, null);
    return {
      ...base,
      start: { tag: 'rodada-tickets', commit: 'c' },
      steps: [step('analista', ['ok'], { changed })],
      actors: {
        analista: { ...base.actors['analista'], policy, readOnly: true },
      },
    };
  };
  expect(permissionsOf(withChange(['?? tickets/ticket-01.txt']))?.score).toBe(
    5,
  );
  expect(permissionsOf(withChange([' M src/main.ts']))).toMatchObject({
    score: 0,
    detail:
      'Alterou fora do que a política libera para escrita:  M src/main.ts.',
  });
});

test('sem instruções, política nem referências, a eficácia não é avaliada, e a eficiência fica sem nota', () => {
  const score = scoreRound(round(['ok'], 30_000, null), []);
  expect(score.actors['analista'].effectiveness.score).toBeNull();
  expect(score.actors['analista'].efficiency.base).toBe(5);
  expect(score.actors['analista'].efficiency.score).toBeNull();
  // Without effectiveness, no final.
  expect(score.actors['analista'].final).toBeNull();
});

test('uma eliminatória zera as duas notas, e dizer nada também', () => {
  const broke = round(['ok'], 30_000, null, {
    violations: [
      {
        rule: 'no-tool-call-as-text',
        actor: 'analista',
        passed: false,
        detail: '',
      },
    ],
  });
  expect(scoreRound(broke, []).actors['analista']).toMatchObject({
    eliminated: ['respondeu com uma chamada de ferramenta escrita como texto'],
    final: 0,
    effectiveness: { score: 0 },
    efficiency: { score: 0 },
  });
  expect(
    scoreRound(round([''], 30_000, null), []).actors['analista'].eliminated,
  ).toEqual(['terminou sem entregar nada']);
});

test('perguntas e ferramentas com erro tiram pontos do processo', () => {
  const wasteful = round(['ok'], 30_000, null, {
    steps: [
      step('analista', ['ok'], {
        asked: ['Posso?'],
        tools: [{ turn: 1, name: 'Bash', detail: {}, outcome: 'error', span }],
      }),
    ],
  });
  expect(
    scoreRound(wasteful, []).actors['analista'].efficiency.criteria.at(-1),
  ).toMatchObject({
    score: 3,
    detail: '1 pergunta(s), 1 ferramenta(s) com erro.',
  });
});

test('limite de tempo declarado: dentro dá 5, acima dá 0', () => {
  const within = round(['ok'], 30_000, null, {
    criteria: { limits: { actorMs: { analista: 60_000 } } },
  });
  const over = round(['ok'], 90_000, null, {
    criteria: { limits: { actorMs: { analista: 60_000 } } },
  });
  expect(scoreRound(within, []).actors['analista'].effectiveness.score).toBe(5);
  expect(scoreRound(over, []).actors['analista'].effectiveness.score).toBe(0);
});
