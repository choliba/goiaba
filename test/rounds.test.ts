import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearConfigCache } from '../src/config/index';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types';
import type { Interaction } from '../src/interaction/index';
import type { Provider, ProviderEvent } from '../src/providers/types';
import {
  defineRound,
  noQuestions,
  noToolCallAsText,
  readOnlyRespected,
  runRound,
  validateRound,
  type RoundDefinition,
} from '../src/rounds/index';
import { StepRecorder } from '../src/rounds/measures';
import { snapshotActor } from '../src/rounds/snapshot';
import { Workspace } from '../src/workspace/index';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
});

/**
 * Answers with `answer`; optionally writes a file first, and reports the
 * tokens and cost of its run as a CLI does.
 */
class ScriptedProvider implements Provider<string, string> {
  public readonly id = 'scripted';
  public readonly prompts: string[] = [];

  public constructor(
    private readonly answer: string,
    private readonly writes?: string,
    private readonly reports = false,
  ) {}

  public describe(): { name: string; model: string } {
    return { name: 'scripted', model: 'modelo-teste' };
  }

  public createCommand(input: string): ProgramCommand {
    this.prompts.push(input);
    const write =
      this.writes === undefined
        ? ''
        : `require('fs').writeFileSync(${JSON.stringify(this.writes)}, 'novo');`;
    return {
      executable: process.execPath,
      arguments: [
        '-e',
        `${write}process.stdout.write(${JSON.stringify(this.answer)})`,
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
    yield { type: 'session', id: `s-${String(this.prompts.length)}` };
    yield {
      type: 'tool',
      phase: 'call',
      detail: { call_id: 't1', tool: 'Bash' },
    };
    yield {
      type: 'tool',
      phase: 'result',
      detail: { call_id: 't1', bytes: 3 },
    };
    if (this.reports) {
      yield {
        type: 'usage',
        usage: { input: 100, output: 10, cachedInput: 60, cacheWrite: 5 },
        action: 'Bash',
      };
      yield { type: 'cost', usd: 0.01 };
    }
    yield { type: 'output', value: text };
  }
}

const quiet: Interaction = {
  ask: () => Promise.resolve(''),
  write: () => undefined,
};

const git = (root: string, ...args: string[]): string => {
  const result = Bun.spawnSync([
    'git',
    '-C',
    root,
    '-c',
    'user.name=dev',
    '-c',
    'user.email=dev@exemplo.com',
    ...args,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
};

const fakeProvider = new ScriptedProvider('ok');

function definition(overrides: Partial<RoundDefinition> = {}): RoundDefinition {
  return {
    id: 'teste',
    goal: 'Testar',
    actors: {
      analista: {
        provider: fakeProvider,
        workspace: { type: 'bubblewrap', root: '/tmp' },
      },
    },
    flow: [{ actor: 'analista', prompt: () => ['Analise.'] }],
    ...overrides,
  };
}

test.each([
  ['id com maiúsculas', { id: 'Teste' }, 'O id da rodada ("Teste")'],
  ['sem goal', { goal: ' ' }, 'não diz o que quer identificar'],
  ['sem passos', { flow: [] }, 'não tem nenhum passo em flow'],
  [
    'passo com agente que não existe',
    { flow: [{ actor: 'revisor', prompt: () => [] }] },
    'o passo 1 usa actor "revisor", que não está em actors (analista)',
  ],
  [
    'by com agente que não existe',
    { flow: [{ actor: 'analista', by: 'chefe', prompt: () => [] }] },
    'o passo 1 usa by "chefe"',
  ],
  ['repeat zero', { repeat: 0 }, 'repeat deve ser um inteiro a partir de 1'],
])('defineRound recusa %s', (_name, overrides, message) => {
  expect(() => defineRound(definition(overrides))).toThrow(message);
});

test('defineRound recusa campo desconhecido', () => {
  const withMeasure = { ...definition(), measure: ['time'] };
  expect(() => defineRound(withMeasure)).toThrow(
    'A rodada teste tem o campo desconhecido "measure"',
  );
});

const at = (second: number): string =>
  `2026-11-04T10:00:${String(second).padStart(2, '0')}.000Z`;

test('StepRecorder mede turnos, ferramentas, tokens, custo, falas, perguntas e rede', () => {
  const recorder = new StepRecorder('analista', (tokens) =>
    tokens.input === null ? null : tokens.input * 0.000001,
  );

  recorder.agent({
    type: 'turn',
    ts: at(0),
    data: { phase: 'start', turn: 1 },
  });
  recorder.agent({
    type: 'tool',
    ts: at(1),
    data: {
      phase: 'call',
      detail: { call_id: 'a', tool: 'Bash', command: 'npm test' },
    },
  });
  recorder.agent({
    type: 'tool',
    ts: at(2),
    data: { phase: 'call', detail: { call_id: 'b', tool: 'Read' } },
  });
  recorder.agent({
    type: 'tool',
    ts: at(5),
    data: { phase: 'error', detail: { call_id: 'a', message: 'falhou' } },
  });
  recorder.agent({
    type: 'usage',
    ts: at(6),
    data: {
      input_tokens: 100,
      output_tokens: 10,
      cost_usd: 0.5,
      action: 'Bash',
    },
  });
  recorder.agent({
    type: 'usage',
    ts: at(7),
    data: { input_tokens: 2000, output_tokens: 20 },
  });
  recorder.agent({ type: 'output', ts: at(8), data: { value: 'Pronto.' } });
  recorder.agent({ type: 'ask', ts: at(8), data: { question: 'Posso?' } });
  recorder.question('Posso?');
  recorder.network({
    type: 'decision',
    ts: at(3),
    data: {
      hostname: 'registry.npmjs.org',
      port: 443,
      protocol: 'https',
      decision: 'deny',
      decidedBy: 'default',
      reason: 'nenhuma regra',
    },
  });
  recorder.agent({ type: 'turn', ts: at(9), data: { phase: 'end', turn: 1 } });

  const measured = recorder.finish(at(10));

  expect(measured.turns).toEqual([
    {
      index: 1,
      span: { startedAt: at(0), endedAt: at(9), durationMs: 9000 },
    },
  ]);
  expect(measured.tools).toEqual([
    {
      turn: 1,
      name: 'Bash',
      detail: {
        call_id: 'a',
        tool: 'Bash',
        command: 'npm test',
        message: 'falhou',
      },
      outcome: 'error',
      span: { startedAt: at(1), endedAt: at(5), durationMs: 4000 },
    },
    {
      turn: 1,
      name: 'Read',
      detail: { call_id: 'b', tool: 'Read' },
      outcome: 'unfinished',
      span: { startedAt: at(2), endedAt: at(10), durationMs: 8000 },
    },
  ]);
  expect(measured.usage).toEqual([
    {
      ts: at(6),
      actor: 'analista',
      turn: 1,
      action: 'Bash',
      tokens: {
        input: 100,
        output: 10,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      costUsd: 0.5,
      costSource: 'cli',
    },
    {
      ts: at(7),
      actor: 'analista',
      turn: 1,
      action: null,
      tokens: {
        input: 2000,
        output: 20,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      costUsd: 0.002,
      costSource: 'table',
    },
  ]);
  expect(measured.said).toEqual(['Pronto.']);
  expect(measured.asked).toEqual(['Posso?']);
  expect(measured.decisions).toEqual([
    {
      ts: at(3),
      destination: 'registry.npmjs.org:443',
      protocol: 'https',
      decision: 'deny',
      decidedBy: 'default',
      reason: 'nenhuma regra',
    },
  ]);
});

test('snapshotActor copia as peças e o hash muda só com a configuração', () => {
  const pieces = {
    role: 'analista',
    provider: fakeProvider,
    workspace: new Workspace({
      type: 'bubblewrap',
      root: '/projeto/ws',
      hostState: 'none',
    }),
    permissions: {
      default: 'deny' as const,
      allow: {
        network: [{ operations: ['connect' as const], hosts: ['example.com'] }],
      },
    },
    readOnly: true,
  };
  const snapshot = snapshotActor(pieces, (path) =>
    path.replace('/projeto', '<projeto>'),
  );

  expect(snapshot.provider).toMatchObject({
    id: 'scripted',
    model: 'modelo-teste',
  });
  expect(snapshot.workspace).toEqual({
    type: 'bubblewrap',
    image: null,
    root: '<projeto>/ws',
    writable: [],
    hostState: 'none',
    ports: [],
  });
  expect(snapshot.network.rules).toEqual({
    default: 'deny',
    allow: [{ operations: ['connect'], hosts: ['example.com'] }],
    requireApproval: [],
    deny: [],
  });
  expect(snapshot.policy).toEqual(pieces.permissions);

  expect(snapshotActor(pieces).configHash).toBe(
    snapshotActor(pieces).configHash,
  );
  expect(snapshotActor({ ...pieces, readOnly: false }).configHash).not.toBe(
    snapshotActor(pieces).configHash,
  );
});

test('readOnlyRespected e noQuestions julgam cada passo', () => {
  const input = {
    steps: [
      { actor: 'analista', said: [], changed: [' M a.ts'], asked: [] },
      {
        actor: 'programador',
        said: [],
        changed: [' M b.ts'],
        asked: ['Posso?'],
      },
    ],
    actors: { analista: { readOnly: true }, programador: { readOnly: false } },
  };

  expect(readOnlyRespected().check(input)).toEqual([
    {
      rule: 'read-only-respected',
      actor: 'analista',
      passed: false,
      detail: 'Alterou arquivos mesmo com o pedido de não alterar:  M a.ts',
    },
  ]);
  expect(
    noQuestions()
      .check(input)
      .map((r) => [r.actor, r.passed]),
  ).toEqual([
    ['analista', true],
    ['programador', false],
  ]);
});

test('noToolCallAsText acusa a chamada de ferramenta escrita como resposta', () => {
  const input = {
    steps: [
      {
        actor: 'product-owner',
        said: [
          '{\n  "name": "exec_command",\n  "arguments": { "cmd": "touch footer.html" }\n}',
        ],
        changed: [],
        asked: [],
      },
      {
        actor: 'analista',
        said: ['O plano: `{ "a": 1 }` em src/x.ts.'],
        changed: [],
        asked: [],
      },
    ],
    actors: {
      'product-owner': { readOnly: true },
      analista: { readOnly: true },
    },
  };

  expect(
    noToolCallAsText()
      .check(input)
      .map((r) => [r.actor, r.passed, r.detail]),
  ).toEqual([
    [
      'product-owner',
      false,
      'Respondeu com a chamada de ferramenta escrita como texto (exec_command), e nada rodou: o modelo não chama as ferramentas da CLI.',
    ],
    [
      'analista',
      true,
      'Não respondeu com uma chamada de ferramenta escrita como texto.',
    ],
  ]);
});

test('runRound parte da tag, passa o que cada um disse adiante, confere pelo git e grava um registro válido', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goiaba-round-ws-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  try {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'a.txt'), 'base');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'tag', 'rodada-base');
    // Left by a previous run: the reset takes it away.
    writeFileSync(join(root, 'sobra.txt'), 'x');

    const analista = new ScriptedProvider('dois problemas', undefined, true);
    const programador = new ScriptedProvider('corrigi', 'b.txt');
    const files = await runRound(
      defineRound({
        id: 'teste',
        goal: 'O analista só lê e o programador corrige',
        start: { git: { root, tag: 'rodada-base' } },
        actors: {
          analista: {
            provider: analista,
            workspace: { type: 'bubblewrap', root },
            readOnly: true,
          },
          programador: {
            provider: programador,
            workspace: { type: 'bubblewrap', root },
          },
        },
        flow: [
          { actor: 'analista', by: 'programador', prompt: () => ['Analise.'] },
          {
            actor: 'programador',
            prompt: ({ said }) => ['Corrija:', said['analista'] ?? ''],
          },
        ],
        rules: [readOnlyRespected()],
      }),
      { dir, project: root, screen: quiet },
    );

    expect(programador.prompts).toEqual(['Corrija:\ndois problemas']);
    expect(files).toHaveLength(1);
    const round = validateRound(
      JSON.parse(readFileSync(files[0] ?? '', 'utf8')),
    );

    expect(round.start?.tag).toBe('rodada-base');
    expect(round.steps.map((s) => [s.actor, s.said, s.changed])).toEqual([
      ['analista', ['dois problemas'], []],
      ['programador', ['corrigi'], ['?? b.txt']],
    ]);
    expect(round.steps[0]?.prompt.text).toBe('Analise.');
    expect(round.steps[0]?.tools.map((t) => [t.name, t.outcome])).toEqual([
      ['Bash', 'result'],
    ]);
    expect(round.actors['analista']?.workspace.root).toBe('<projeto>');
    expect(round.measures['programador']).toMatchObject({
      turns: 1,
      tools: 1,
      changedFiles: 1,
    });
    // The analyst's CLI reports a request and the run's cost; the
    // programmer's reports nothing: not measured, not 0.
    expect(round.usage.map((u) => [u.actor, u.action, u.costSource])).toEqual([
      ['analista', 'Bash', null],
      ['analista', null, 'cli'],
    ]);
    const analystTotal = {
      tokens: {
        input: 100,
        output: 10,
        cacheRead: 60,
        cacheWrite: 5,
        reasoning: null,
      },
      costUsd: 0.01,
    };
    expect(round.totals.round).toEqual(analystTotal);
    expect(round.totals.actors['analista']).toEqual(analystTotal);
    expect(round.totals.actors['programador']).toEqual({
      tokens: {
        input: null,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      costUsd: null,
    });
    expect(round.violations).toEqual([
      {
        rule: 'read-only-respected',
        actor: 'analista',
        passed: true,
        detail: 'O git não mostra nenhuma alteração.',
      },
    ]);
    expect(round.timing.durationMs).toBeGreaterThanOrEqual(
      round.timing.actors['analista'].durationMs,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
