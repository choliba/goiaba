import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearConfigCache } from '../src/config/index';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types';
import { format } from 'prettier';

import { agentSource, declarationSource } from '../rounds/web/src/declaration';
import { importLine } from '../rounds/web/src/source';
import { toolsOf } from '../rounds/web/src/project-tools';
import type { RoundCriterion, RoundDeclaration } from '../src/rounds/types';
import type { Interaction } from '../src/interaction/index';
import type { Provider, ProviderEvent } from '../src/providers/types';
import {
  captureDeclaration,
  defineRound,
  findDefinition,
  listDefinitions,
  noQuestions,
  noToolCallAsText,
  readOnlyRespected,
  runRound,
  writableOf,
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

test.each<[string, Partial<RoundDefinition>, string]>([
  ['id com maiúsculas', { id: 'Teste' }, 'O id da rodada ("Teste")'],
  ['sem goal', { goal: ' ' }, 'não diz o que quer identificar'],
  ['label vazio', { label: ' ' }, 'tem um label vazio'],
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
  [
    'start com fixture e git juntos',
    {
      start: Object.assign(
        { fixture: 'site-vazio' },
        { git: { root: '/tmp', tag: 'rodada-base' } },
      ),
    },
    'um dos dois',
  ],
  [
    'fixture que não é um nome de pasta',
    { start: { fixture: '../fora' } },
    'start.fixture deve ser o nome de uma pasta',
  ],
  [
    'critério de arquivo com caminho absoluto',
    { criteria: { analista: [{ file: { name: '/etc/passwd' } }] } },
    'caminho relativo à raiz do workspace',
  ],
  [
    'critério sem file, limit ou if',
    // @ts-expect-error: critério inválido de propósito, para a recusa.
    { criteria: { analista: [{}] } },
    'um critério precisa ter file, limit ou if',
  ],
  [
    'critério de agente que não existe',
    { criteria: { revisor: [{ file: { name: 'a.txt' } }] } },
    'criteria fala de "revisor"',
  ],
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

test('StepRecorder junta a decisão do gate à ferramenta que rodou o comando', () => {
  const recorder = new StepRecorder('analista', 0);
  const call = (id: string, command: string, ts: number): void => {
    recorder.agent({
      type: 'tool',
      ts: at(ts),
      data: {
        phase: 'call',
        detail: { call_id: id, tool: 'Bash', args: { command } },
      },
    });
  };
  call('a', 'ls', 1);
  call('b', 'find . 2>/dev/null | head -5', 2);
  recorder.command({
    type: 'decision',
    ts: at(3),
    data: {
      command: 'find . 2>/dev/null | head -5',
      decision: 'deny',
      source: 'default',
      reason: 'Nenhuma regra corresponde à ação.',
      policy: 'deny',
      policySource: 'default',
      part: 'head -5',
      pattern: 'head *',
      complex: true,
    },
  });
  recorder.command({ type: 'decision', ts: at(3), data: { command: 'x' } });

  const [ls, find] = recorder.finish(at(4)).tools;

  expect(ls.policy).toBeUndefined();
  expect(find.policy).toEqual({
    decision: 'deny',
    decidedBy: 'default',
    policy: 'deny',
    source: 'default',
    part: 'head -5',
    pattern: 'head *',
    complex: true,
    reason: 'Nenhuma regra corresponde à ação.',
  });
});

test('StepRecorder mede turnos, ferramentas, tokens, custo, falas, perguntas e rede', () => {
  const recorder = new StepRecorder('analista', 0, (tokens) =>
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
      step: 0,
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
      step: 0,
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
    policy: {
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
  expect(snapshot.policy).toEqual(pieces.policy);

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
    actors: {
      analista: { readOnly: true, writable: [] },
      programador: { readOnly: false, writable: [] },
    },
  };

  expect(readOnlyRespected().check(input)).toEqual([
    {
      rule: 'read-only-respected',
      actor: 'analista',
      passed: false,
      detail:
        'Alterou arquivos fora do que a política libera para escrita:  M a.ts',
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

test('readOnlyRespected aceita o que a política libera para escrita, e só isso', () => {
  const input = {
    steps: [
      {
        actor: 'product-owner',
        said: [],
        changed: ['?? tickets/ticket-01.txt'],
        asked: [],
      },
      {
        actor: 'analista',
        said: [],
        changed: ['?? tickets/ticket-01.txt', ' M src/main.ts'],
        asked: [],
      },
    ],
    actors: {
      'product-owner': { readOnly: true, writable: ['tickets/**'] },
      analista: { readOnly: true, writable: ['tickets/**'] },
    },
  };
  expect(
    readOnlyRespected()
      .check(input)
      .map((r) => [r.actor, r.passed, r.detail]),
  ).toEqual([
    [
      'product-owner',
      true,
      'Só alterou onde a política libera escrita (tickets/**): ?? tickets/ticket-01.txt',
    ],
    [
      'analista',
      false,
      'Alterou arquivos fora do que a política libera para escrita:  M src/main.ts',
    ],
  ]);
});

test('writableOf: os caminhos com escrita na política, relativos ao workspace', () => {
  expect(
    writableOf({
      default: 'deny',
      allow: {
        filesystem: [
          { operations: ['read'], paths: ['/workspace/**'] },
          { operations: ['write'], paths: ['/workspace/tickets/**'] },
        ],
      },
    }),
  ).toEqual(['tickets/**']);
  expect(writableOf(null)).toEqual([]);
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
      'product-owner': { readOnly: true, writable: [] },
      analista: { readOnly: true, writable: [] },
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

test('runRound não grava registro quando falha antes do primeiro agente', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goiaba-round-ws-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  // The Goiaba's project: apart from the round's folder, as required.
  const project = mkdtempSync(join(tmpdir(), 'goiaba-round-project-'));
  try {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'a.txt'), 'base');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');

    await expect(
      runRound(
        defineRound({
          id: 'teste',
          goal: 'g',
          start: { git: { root, tag: 'Os dois escrevem em um arquivo' } },
          actors: {
            analista: {
              provider: new ScriptedProvider('ok'),
              workspace: { type: 'bubblewrap', root },
            },
          },
          flow: [{ actor: 'analista', prompt: () => ['Analise.'] }],
        }),
        { dir, project, screen: quiet },
      ),
    ).rejects.toThrow('não tem a tag Os dois escrevem em um arquivo');
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

test('runRound parte da tag, passa o que cada um disse adiante, confere pelo git e grava um registro válido', async () => {
  const root = mkdtempSync(join(tmpdir(), 'goiaba-round-ws-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  // The Goiaba's project: apart from the round's folder, as required.
  const project = mkdtempSync(join(tmpdir(), 'goiaba-round-project-'));
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
        criteria: {
          programador: [
            { file: { name: 'b.txt', contains: ['NOVO'] } },
            { file: { name: 'c.txt', exists: true } },
            // b.txt did not exist when the programmer started: else applies.
            {
              if: { name: 'b.txt', exists: true },
              check: [{ file: { name: 'b.txt', contains: ['velho'] } }],
              else: [{ file: { name: '*', changed: false } }],
            },
            // a.txt existed: the check branch applies.
            {
              if: { name: 'a.txt', exists: true },
              check: [{ file: { name: 'a.txt', contains: ['base'] } }],
            },
          ],
          // The analyst: zzz.txt did not exist, so nothing applies.
          analista: [
            {
              if: { name: 'zzz.txt', exists: true },
              check: [{ file: { name: 'zzz.txt', matches: [/z+/] } }],
            },
          ],
        },
      }),
      { dir, project, screen: quiet, label: 'analista só lê' },
    );

    expect(programador.prompts).toEqual(['Corrija:\ndois problemas']);
    expect(files).toHaveLength(1);
    const round = validateRound(
      JSON.parse(readFileSync(files[0] ?? '', 'utf8')),
    );

    expect(round.start?.tag).toBe('rodada-base');
    expect(round.label).toBe('analista só lê');
    // A RegExp of the declaration is kept as its source, not as `{}`.
    expect(round.criteria?.['analista']?.[0]).toEqual({
      if: { name: 'zzz.txt', exists: true },
      check: [{ file: { name: 'zzz.txt', matches: ['z+'] } }],
    });
    // Checked against the workspace at the end of the step: only the verdict.
    expect(round.steps[1]?.criteria).toEqual([
      {
        description: 'b.txt contém "NOVO"',
        met: true,
        detail: 'b.txt contém "NOVO".',
      },
      { description: 'c.txt existe', met: false, detail: 'c.txt não existe.' },
      // else branch (b.txt did not exist at the start): nothing may have changed.
      {
        description: '* não mudou',
        met: false,
        detail: 'b.txt mudou, mas não devia.',
      },
      // check branch (a.txt existed at the start).
      {
        description: 'a.txt contém "base"',
        met: true,
        detail: 'a.txt contém "base".',
      },
    ]);
    // A condition that did not hold, with no else: nothing applies.
    expect(round.steps[0]?.criteria).toEqual([]);
    expect(round.steps.map((s) => [s.actor, s.said, s.changed])).toEqual([
      ['analista', ['dois problemas'], []],
      ['programador', ['corrigi'], ['?? b.txt']],
    ]);
    expect(round.steps[0]?.prompt.text).toBe('Analise.');
    expect(round.steps.map((step) => step.key)).toEqual([
      'analista#1',
      'programador#1',
    ]);
    expect(round.steps[0]?.totals).toEqual({
      tokens: {
        input: 100,
        output: 10,
        cacheRead: 60,
        cacheWrite: 5,
        reasoning: null,
      },
      fresh: 50,
      costUsd: 0.01,
    });
    expect(round.usage.map((u) => u.step)).toEqual([0, 0]);
    // Nothing cited: checked, and none to check.
    expect(round.steps[0]?.references).toEqual({
      cited: 0,
      valid: 0,
      invalid: [],
    });
    expect(round.steps[0]?.tools.map((t) => [t.name, t.outcome])).toEqual([
      ['Bash', 'result'],
    ]);
    expect(round.actors['analista']?.workspace.root).toBe(root);
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
      fresh: 50,
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
      fresh: null,
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
    rmSync(project, { recursive: true, force: true });
  }
});

/** A project with `rounds/fixtures/<name>` holding `files`, and a rounds.dir apart from it. */
function fixtureSetup(
  name: string,
  files: Readonly<Record<string, string>>,
): {
  readonly project: string;
  readonly roundsDir: string;
  readonly dir: string;
  readonly cleanup: () => void;
} {
  const project = mkdtempSync(join(tmpdir(), 'goiaba-round-project-'));
  const roundsDir = mkdtempSync(join(tmpdir(), 'goiaba-round-dirs-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  const fixture = join(project, 'rounds', 'fixtures', name);
  mkdirSync(fixture, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture, file), content);
  }
  return {
    project,
    roundsDir,
    dir,
    cleanup: () => {
      for (const path of [project, roundsDir, dir]) {
        rmSync(path, { recursive: true, force: true });
      }
    },
  };
}

const fromFixture = (
  root: string,
  provider: Provider<string, string>,
  fixture = 'site-vazio',
): RoundDefinition =>
  defineRound({
    id: 'teste',
    goal: 'g',
    start: { fixture },
    actors: {
      analista: { provider, workspace: { type: 'bubblewrap', root } },
    },
    flow: [{ actor: 'analista', prompt: () => ['Escreva.'] }],
  });

test('runRound de uma fixture cria a pasta com repositório e tag, e cada execução recomeça limpa', async () => {
  const { project, roundsDir, dir, cleanup } = fixtureSetup('site-vazio', {
    'README.md': 'base\n',
  });
  const root = join(roundsDir, 'teste');
  try {
    const first = await runRound(
      fromFixture(root, new ScriptedProvider('ok', 'b.txt')),
      { dir, project, roundsDir, screen: quiet },
    );
    const record = validateRound(
      JSON.parse(readFileSync(first[0] ?? '', 'utf8')),
    );
    expect(record.start).toMatchObject({
      tag: 'rodada-base',
      fixture: 'site-vazio',
    });
    expect(record.steps[0]?.changed).toEqual(['?? b.txt']);
    expect(git(root, 'tag').trim()).toBe('rodada-base');
    expect(git(root, 'rev-parse', '--show-toplevel').trim()).toEndWith('teste');

    // What the first run left is gone: the folder is recreated.
    await runRound(fromFixture(root, new ScriptedProvider('ok')), {
      dir,
      project,
      roundsDir,
      screen: quiet,
    });
    expect(existsSync(join(root, 'b.txt'))).toBe(false);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('base\n');
  } finally {
    cleanup();
  }
});

test('runRound pergunta os inputs uma vez, antes de rodar, e os entrega aos prompts e aos critérios, com o número da execução', async () => {
  const { project, roundsDir, dir, cleanup } = fixtureSetup('site-vazio', {
    'README.md': 'base\n',
  });
  const root = join(roundsDir, 'perguntas');
  // A conversation's `ask` does not show the question: it is written first.
  const asked: string[] = [];
  const shown: string[] = [];
  const screen: Interaction = {
    ask: () => {
      asked.push(shown.at(-1) ?? '');
      return Promise.resolve(' novo ');
    },
    write: (value) => {
      shown.push(value);
    },
  };
  const provider = new ScriptedProvider('ok', 'b.txt');
  const round = defineRound({
    id: 'perguntas',
    goal: 'g',
    start: { fixture: 'site-vazio' },
    inputs: { termo: 'O que escrever?' },
    actors: { dev: { provider, workspace: { type: 'bubblewrap', root } } },
    flow: [
      {
        actor: 'dev',
        prompt: ({ inputs, repeat }) => [
          `Escreva ${inputs['termo'] ?? ''}.`,
          `Tentativa ${String(repeat.index)} de ${String(repeat.total)}.`,
        ],
      },
    ],
    criteria: {
      dev: [{ file: { name: 'b.txt', contains: ['{{input:termo}}'] } }],
    },
    repeat: 2,
  });
  try {
    const files = await runRound(round, {
      dir,
      project,
      roundsDir,
      screen,
    });
    // Asked once for both runs, the answer trimmed.
    expect(asked).toEqual(['O que escrever?']);
    expect(
      provider.prompts.every((prompt) => prompt.includes('Escreva novo.')),
    ).toBe(true);
    // Each run knows which it is.
    expect(provider.prompts.map((prompt) => prompt.split('\n')[1])).toEqual([
      'Tentativa 1 de 2.',
      'Tentativa 2 de 2.',
    ]);
    const record = validateRound(
      JSON.parse(readFileSync(files[0] ?? '', 'utf8')),
    );
    expect(record.steps[0]?.criteria).toEqual([
      {
        description: 'b.txt contém "novo"',
        met: true,
        detail: 'b.txt contém "novo".',
      },
    ]);
    // The declaration keeps the question and the marker, not the answer.
    expect(record.declaration?.inputs).toEqual({ termo: 'O que escrever?' });
    expect(record.declaration?.flow[0]?.prompt).toEqual([
      'Escreva {{input:termo}}.',
      'Tentativa {{repeat:index}} de {{repeat:total}}.',
    ]);
    // And the file written back says it the same way.
    if (record.declaration === undefined) throw new Error('sem declaração');
    const source = declarationSource(record.declaration);
    expect(source).toContain('prompt: ({ inputs, repeat }) => [');
    expect(source).toContain(
      '`Tentativa ${String(repeat.index)} de ${String(repeat.total)}.`',
    );

    // Given beforehand, nothing is asked.
    asked.length = 0;
    await runRound(round, {
      dir,
      project,
      roundsDir,
      screen,
      inputs: { termo: 'novo' },
    });
    expect(asked).toEqual([]);
  } finally {
    cleanup();
  }
});

/** A round with only `criterion` for its one agent. */
const withCriterion = (criterion: RoundCriterion): unknown =>
  defineRound({
    id: 'dois-tipos',
    goal: 'g',
    actors: {
      dev: {
        provider: new ScriptedProvider('ok'),
        workspace: { type: 'bubblewrap', root: '/tmp/x' },
      },
    },
    flow: [{ actor: 'dev', prompt: () => ['x'] }],
    criteria: { dev: [criterion] },
  });

test('defineRound recusa um critério com dois tipos ou com um campo desconhecido', () => {
  // Kept in variables: as literals, the typecheck would refuse them first.
  const twoKinds = { file: { name: 'a.txt' }, limit: { time: '2min' } };
  const misspelled = { file: { name: 'a.txt', contain: ['x'] } };
  const unknownLimit = { limit: { time: '2min', custo: '1' } };
  expect(() => withCriterion(twoKinds)).toThrow(
    'um critério tem um tipo só, e este tem file e limit',
  );
  expect(() => withCriterion(misspelled)).toThrow(
    '"contain" não é um campo daqui',
  );
  expect(() => withCriterion(unknownLimit)).toThrow(
    '"custo" não é um campo daqui',
  );
});

test('defineRound recusa um critério com {{input:…}} que inputs não pergunta', () => {
  expect(() =>
    defineRound({
      id: 'sem-pergunta',
      goal: 'g',
      actors: {
        dev: {
          provider: new ScriptedProvider('ok'),
          workspace: { type: 'bubblewrap', root: '/tmp/x' },
        },
      },
      flow: [{ actor: 'dev', prompt: () => ['x'] }],
      criteria: {
        dev: [{ file: { name: 'a.txt', contains: ['{{input:termo}}'] } }],
      },
    }),
  ).toThrow(
    'criteria usa {{input:termo}}, mas inputs não tem a pergunta termo',
  );
});

test('runRound de uma fixture que não existe diz quais existem', async () => {
  const { project, roundsDir, dir, cleanup } = fixtureSetup('site-vazio', {});
  try {
    await expect(
      runRound(fromFixture(join(roundsDir, 'teste'), fakeProvider, 'outra'), {
        dir,
        project,
        roundsDir,
        screen: quiet,
      }),
    ).rejects.toThrow('As que existem: site-vazio');
  } finally {
    cleanup();
  }
});

test('runRound de uma fixture sem rounds.dir pede para configurar', async () => {
  const { project, dir, cleanup } = fixtureSetup('site-vazio', {});
  try {
    await expect(
      runRound(fromFixture('/tmp/teste', fakeProvider), {
        dir,
        project,
        roundsDir: undefined,
        screen: quiet,
      }),
    ).rejects.toThrow('Configure rounds.dir');
  } finally {
    cleanup();
  }
});

test('runRound recusa um ator que trabalha fora da pasta da rodada', async () => {
  const { project, roundsDir, dir, cleanup } = fixtureSetup('site-vazio', {});
  try {
    await expect(
      runRound(fromFixture(join(roundsDir, 'outra-pasta'), fakeProvider), {
        dir,
        project,
        roundsDir,
        screen: quiet,
      }),
    ).rejects.toThrow('não é a pasta da rodada');
  } finally {
    cleanup();
  }
});

test('runRound recusa uma pasta sem .git próprio e não toca no repositório em volta', async () => {
  const outer = mkdtempSync(join(tmpdir(), 'goiaba-round-outer-'));
  const project = mkdtempSync(join(tmpdir(), 'goiaba-round-project-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  const root = join(outer, 'ws');
  try {
    git(outer, 'init', '-q');
    writeFileSync(join(outer, 'a.txt'), 'base');
    git(outer, 'add', '.');
    git(outer, 'commit', '-q', '-m', 'base');
    git(outer, 'tag', 'rodada-base');
    writeFileSync(join(outer, 'pendente.txt'), 'não commitado');
    mkdirSync(root);

    await expect(
      runRound(
        defineRound({
          id: 'teste',
          goal: 'g',
          start: { git: { root, tag: 'rodada-base' } },
          actors: {
            analista: {
              provider: fakeProvider,
              workspace: { type: 'bubblewrap', root },
            },
          },
          flow: [{ actor: 'analista', prompt: () => ['Analise.'] }],
        }),
        { dir, project, screen: quiet },
      ),
    ).rejects.toThrow('não é a raiz de um repositório git');
    // The reset never reached the repository around it.
    expect(readFileSync(join(outer, 'pendente.txt'), 'utf8')).toBe(
      'não commitado',
    );
  } finally {
    for (const path of [outer, project, dir]) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

test('runRound recusa start.git no próprio projeto', async () => {
  const project = mkdtempSync(join(tmpdir(), 'goiaba-round-project-'));
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-data-'));
  try {
    git(project, 'init', '-q');
    git(project, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(project, 'tag', 'rodada-base');
    await expect(
      runRound(
        defineRound({
          id: 'teste',
          goal: 'g',
          start: { git: { root: project, tag: 'rodada-base' } },
          actors: {
            analista: {
              provider: fakeProvider,
              workspace: { type: 'bubblewrap', root: project },
            },
          },
          flow: [{ actor: 'analista', prompt: () => ['Analise.'] }],
        }),
        { dir, project, screen: quiet },
      ),
    ).rejects.toThrow('se sobrepõem');
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findDefinition acha <id>.ts ou <id>/<id>.ts, e lista só as rodadas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-defs-'));
  try {
    writeFileSync(join(dir, 'solta.ts'), '');
    mkdirSync(join(dir, 'em-pasta'));
    writeFileSync(join(dir, 'em-pasta', 'em-pasta.ts'), '');
    // A piece of the round, not a round.
    writeFileSync(join(dir, 'em-pasta', 'politica.ts'), '');
    // A folder without its <id>.ts is not a round.
    mkdirSync(join(dir, 'rascunho'));

    expect(findDefinition(dir, 'solta')).toBe(join(dir, 'solta.ts'));
    expect(findDefinition(dir, 'em-pasta')).toBe(
      join(dir, 'em-pasta', 'em-pasta.ts'),
    );
    expect(listDefinitions(dir)).toEqual(['em-pasta', 'solta']);
    expect(() => findDefinition(dir, 'politica')).toThrow(
      'As que existem: em-pasta, solta.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findDefinition recusa a mesma rodada nos dois formatos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-round-defs-'));
  try {
    writeFileSync(join(dir, 'dupla.ts'), '');
    mkdirSync(join(dir, 'dupla'));
    writeFileSync(join(dir, 'dupla', 'dupla.ts'), '');
    expect(() => findDefinition(dir, 'dupla')).toThrow(
      'está declarada duas vezes',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** What `defineRound` returns, enough to read it back. */
function isRoundDefinition(value: unknown): value is RoundDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'flow' in value &&
    Array.isArray(value.flow)
  );
}

test('a declaração vira dados e volta a ser um arquivo que declara a mesma rodada', async () => {
  const original = defineRound({
    id: 'ida-e-volta',
    goal: 'O analista lê e o programador corrige',
    start: { git: { root: '/tmp/rodada', tag: 'rodada-base' } },
    actors: {
      analista: {
        provider: new ScriptedProvider('ok'),
        workspace: {
          type: 'bubblewrap',
          root: '/tmp/rodada',
          hostState: 'none',
          writable: ['/tmp/rodada/notas'],
          ports: [5173],
        },
        policy: {
          default: 'deny',
          allow: {
            filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
          },
        },
        readOnly: true,
      },
      programador: {
        provider: new ScriptedProvider('ok'),
        workspace: {
          type: 'bubblewrap',
          root: '/tmp/rodada',
          hostState: 'none',
        },
      },
    },
    flow: [
      {
        actor: 'analista',
        by: 'programador',
        prompt: () => ['Analise.', 'Cite `arquivo:linha`.'],
      },
      {
        actor: 'programador',
        prompt: ({ said }) => [
          'Corrija:',
          said['analista'] ?? '',
          `Resumo: ${said['analista'] ?? ''}.`,
        ],
      },
    ],
    criteria: {
      analista: [{ file: { name: '*', changed: false } }],
      round: [{ limit: { time: '60s' } }],
    },
    rules: [readOnlyRespected(), noQuestions()],
    repeat: 2,
  });

  const declaration = captureDeclaration(original, 'troquei o prompt');
  expect(declaration.flow[1]?.prompt).toEqual([
    'Corrija:',
    '{{said:analista}}',
    'Resumo: {{said:analista}}.',
  ]);
  expect(declaration.rules).toEqual(['read-only-respected', 'no-questions']);
  expect(declaration.actors['analista']?.provider.name).toBe('scripted');

  // A provider the generator knows, so the file loads: the scripted one is a test's.
  const known = {
    ...declaration,
    actors: Object.fromEntries(
      Object.entries(declaration.actors).map(([name, actor]) => [
        name,
        {
          ...actor,
          // An Ollama provider always says its window.
          provider: {
            name: 'ollama',
            cli: 'claude',
            model: 'qwen3.5:4b',
            contextWindow: 32_768,
            // What the declaration's fields do not say goes back as written.
            options: { baseUrl: 'http://127.0.0.1:11435' },
          },
        },
      ]),
    ),
  };
  expect(declaration.actors['analista']?.workspace).toMatchObject({
    writable: ['/tmp/rodada/notas'],
    ports: [5173],
  });
  const source = declarationSource(known);
  expect(source).toContain("cli: 'claude',");
  expect(source).toContain("baseUrl: 'http://127.0.0.1:11435'");
  expect(source).toContain('ports: [5173]');
  // Already in the project's style: prettier changes nothing.
  expect(
    await format(source, { parser: 'typescript', singleQuote: true }),
  ).toBe(source);
  expect(source).toContain("said['analista'] ?? ''");
  expect(source).toContain('rules: [readOnlyRespected(), noQuestions()]');

  // Written where declarations live, loaded, and captured again: the same.
  const file = join(
    import.meta.dir,
    '..',
    'rounds',
    'definitions',
    `zz-ida-e-volta-${String(process.pid)}.ts`,
  );
  try {
    writeFileSync(file, source);
    const loaded: unknown = await import(file);
    const written =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : undefined;
    if (!isRoundDefinition(written)) throw new Error('não exportou a rodada');
    const again = captureDeclaration(written, 'troquei o prompt');
    expect(again).toEqual(known);
  } finally {
    rmSync(file, { force: true });
  }
});

test('agentSource gera um agente de agents/ com provider, workspace, política e tools', async () => {
  const source = agentSource('product-owner', {
    provider: {
      name: 'ollama',
      cli: 'claude',
      model: 'qwen3.5:4b',
      contextWindow: 100_000,
      think: false,
      tools: ['file_read', 'file_edit', 'file_write'],
    },
    workspace: {
      type: 'bubblewrap',
      image: null,
      root: '<projeto>/x',
      hostState: 'none',
    },
    policy: {
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
        execution: [
          {
            operations: ['run'],
            commands: ['ls *', 'cat *', 'pwd', 'git status', 'git diff *'],
          },
        ],
        web: [
          { operations: ['search'], domains: ['*'] },
          { operations: ['read_text'], domains: ["docs.o'reilly.com"] },
        ],
      },
    },
    readOnly: false,
  });

  expect(source).toContain('await new Agent({');
  expect(source).toContain("name: 'product-owner'");
  // O workspace aponta para a pasta configurada, não a da rodada.
  expect(source).toContain('root: getConfig().workspaces.dir');
  expect(source).toContain('}).run();');
  // Already in the project's style: prettier changes nothing.
  expect(
    await format(source, { parser: 'typescript', singleQuote: true }),
  ).toBe(source);
});

test('o registro guarda a declaração com que rodou', async () => {
  const { project, roundsDir, dir, cleanup } = fixtureSetup('site-vazio', {});
  try {
    const [file = ''] = await runRound(
      fromFixture(join(roundsDir, 'teste'), new ScriptedProvider('ok')),
      { dir, project, roundsDir, screen: quiet },
    );
    const round = validateRound(JSON.parse(readFileSync(file, 'utf8')));
    expect(round.declaration?.start).toEqual({ fixture: 'site-vazio' });
    expect(round.declaration?.flow).toEqual([
      { actor: 'analista', by: null, prompt: ['Escreva.'] },
    ]);
  } finally {
    cleanup();
  }
});

test('declarationSource escreve uma ferramenta do projeto como o import dela, e a rodada volta igual', async () => {
  const path = join(
    import.meta.dir,
    '..',
    'agents',
    'tools',
    'fetch-web-content.ts',
  );
  const tools = toolsOf(path, readFileSync(path, 'utf8'));
  expect(tools).toEqual([
    expect.objectContaining({
      name: 'goiaba/fetch_web_content',
      binding: 'FETCH_WEB_CONTENT',
      from: '../../agents/tools/fetch-web-content',
    }),
  ]);

  const declaration: RoundDeclaration = {
    id: 'zz-ferramenta',
    goal: 'Buscar com a ferramenta do projeto.',
    // No start: the root is written as is (roundDir needs rounds.dir).
    start: null,
    actors: {
      buscador: {
        provider: {
          name: 'ollama',
          cli: 'claude',
          model: 'qwen3.5:4b',
          contextWindow: 32_768,
          think: false,
          tools: ['file_write', 'goiaba/fetch_web_content'],
        },
        workspace: {
          type: 'bubblewrap',
          image: null,
          root: '/tmp/zz-ferramenta',
          hostState: 'none',
        },
        policy: {
          default: 'deny',
          allow: {
            filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
            tools: [
              { operations: ['call'], tools: ['goiaba/fetch_web_content'] },
            ],
          },
        },
        readOnly: false,
      },
    },
    flow: [{ actor: 'buscador', by: null, prompt: ['Busque.'] }],
    rules: ['no-questions'],
    repeat: 1,
  };
  const source = declarationSource(declaration, tools);
  expect(source.split('\n')[0]).toBe(
    "import { FETCH_WEB_CONTENT } from '../../agents/tools/fetch-web-content';",
  );
  expect(source).toContain("tools: ['file_write', FETCH_WEB_CONTENT],");
  expect(source).toContain(
    "tools: [{ operations: ['call'], tools: [FETCH_WEB_CONTENT] }],",
  );
  expect(
    await format(source, { parser: 'typescript', singleQuote: true }),
  ).toBe(source);

  // Loaded by the engine: the import registers the tool, the names come back.
  const file = join(
    import.meta.dir,
    '..',
    'rounds',
    'definitions',
    `zz-ferramenta-${String(process.pid)}.ts`,
  );
  try {
    writeFileSync(file, source);
    const loaded: unknown = await import(file);
    const written =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : undefined;
    if (!isRoundDefinition(written)) throw new Error('não exportou a rodada');
    const again = captureDeclaration(written, undefined);
    expect(again).toEqual(declaration);
  } finally {
    rmSync(file, { force: true });
  }
});

test('importLine põe o import numa linha e, longo demais, um nome por linha, como o prettier', async () => {
  const short = importLine(['defineRound', 'roundDir'], 'goiaba/rounds');
  expect(short).toBe("import { defineRound, roundDir } from 'goiaba/rounds';");
  // Every rule of a round, plus roundDir: past the line's width.
  const long = importLine(
    [
      'defineRound',
      'noQuestions',
      'noToolCallAsText',
      'readOnlyRespected',
      'roundDir',
    ],
    'goiaba/rounds',
  );
  expect(long.split('\n')).toHaveLength(7);
  for (const line of [short, long]) {
    expect(
      await format(line, { parser: 'typescript', singleQuote: true }),
    ).toBe(`${line}\n`);
  }
});
