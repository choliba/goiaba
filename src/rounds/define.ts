/**
 * A round's declaration: who takes part, in which order, from where, and
 * what is checked. It only declares; `runRound` runs it. Nothing here goes
 * into `runScript` or `Agent.run()`: a round composes agents, the agents do
 * not know they are in one.
 */

import type { AgentProvider } from '../agent/types';
import { UsageError } from '../errors';
import type { AgentPolicy } from '../policy/policy.interface';
import type { WorkspaceOptions } from '../workspace/index';
import { parseDuration } from './criteria';
import type { RoundCriteria, RoundCriterion, RuleResult } from './types';

/** One agent of the round. */
export interface RoundActor {
  readonly provider: AgentProvider;
  /** A new workspace with these options for every step of the actor. */
  readonly workspace: WorkspaceOptions;
  readonly policy?: AgentPolicy;
  /** Told not to change any file: the git checks it (`readOnlyRespected`). */
  readonly readOnly?: boolean;
}

/** What a step's prompt can use: what the agents said before it, and the answers. */
export interface RoundContext {
  /** By actor, everything it said in its last step, joined. */
  readonly said: Readonly<Record<string, string>>;
  /** By name, the answer to each of the round's `inputs`. */
  readonly inputs: Readonly<Record<string, string>>;
  /**
   * Which run of the round this is: `index` from 1 to `total` (the
   * declaration's `repeat`). The same names as the record's `repeat`.
   */
  readonly repeat: RoundRepeat;
}

/** A run of the round among its repetitions: `index` of `total`, from 1. */
export interface RoundRepeat {
  readonly index: number;
  readonly total: number;
}

export interface RoundFlowStep {
  readonly actor: string;
  /** Who consults it, shown before it; another actor of the round. */
  readonly by?: string;
  /** Lines of the prompt; joined with `\n`. */
  readonly prompt: (context: RoundContext) => readonly string[];
}

/** What a rule sees: the steps as they ran, and each actor's declaration. */
export interface RuleInput {
  readonly steps: readonly {
    readonly actor: string;
    readonly said: readonly string[];
    readonly changed: readonly string[];
    readonly asked: readonly string[];
  }[];
  readonly actors: Readonly<
    Record<
      string,
      {
        readonly readOnly: boolean;
        /**
         * Where its policy lets it write, relative to the workspace's root
         * (`tickets/**`): what a read-only actor may still change.
         */
        readonly writable: readonly string[];
      }
    >
  >;
}

/** A check made from outside the agents, after the round. */
export interface RoundRule {
  /** `read-only-respected`. */
  readonly id: string;
  check(input: RuleInput): readonly RuleResult[];
}

export interface RoundStartGit {
  /** The workspace's git repository. */
  readonly root: string;
  /** The tag every run starts from: the workspace is reset to it. */
  readonly tag: string;
}

/**
 * Where every run starts from:
 * - `fixture`: a folder of `rounds/fixtures`, copied into the round's own
 *   folder (`roundDir(id)`, in `rounds.dir`) with a fresh repository;
 * - `git`: a tag in a repository that already exists (a real project).
 * Either way the folder must be the top of its own repository, apart from
 * the Goiaba's project.
 */
export type RoundStartDefinition =
  { readonly fixture: string } | { readonly git: RoundStartGit };

export interface RoundDefinition {
  /** `analise-programacao-revisao`: lowercase letters, digits and `-`. */
  readonly id: string;
  /** What the round wants to find out, in the user's language. */
  readonly goal: string;
  /**
   * What changed since the last run, in your words (`troquei o modelo para
   * o qwen3.5:4b`): recorded in every run until you change it. Only a note:
   * it changes no configuration. `bun run rounds <id> --label "…"` wins.
   */
  readonly label?: string;
  readonly start?: RoundStartDefinition;
  readonly actors: Readonly<Record<string, RoundActor>>;
  readonly flow: readonly RoundFlowStep[];
  readonly rules?: readonly RoundRule[];
  /**
   * The criteria of a good round, by actor name (and `round` for the whole
   * round): file assertions, limits, and conditionals. Score whether it did
   * what it was asked (see rounds/README.md).
   */
  readonly criteria?: RoundCriteria;
  /**
   * What the round asks before it runs, by name: `{ termo: 'Quem você quer
   * pesquisar?' }`. Asked once, for every repetition; the prompts get the
   * answers (`({ inputs }) => …`) and the criteria take `{{input:termo}}`.
   * The declaration keeps the questions, never the answers.
   */
  readonly inputs?: Readonly<Record<string, string>>;
  /** How many times it runs, each run its own record; 1 by default. */
  readonly repeat?: number;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KNOWN_FIELDS = new Set([
  'id',
  'goal',
  'label',
  'start',
  'actors',
  'flow',
  'rules',
  'repeat',
  'criteria',
  'inputs',
]);

/** An input's name: lowercase letters, digits and `-`, as `termo`. */
const INPUT = /^[a-z][a-z0-9-]*$/;

/** `{{input:termo}}`: where a criterion takes an input's answer. */
export const INPUT_MARKER = /\{\{input:([^}]+)\}\}/g;

/**
 * The declaration, checked: an unknown field, an actor the flow names but
 * the round does not have, an empty flow… are `UsageError`s that say what
 * to fix.
 */
export function defineRound(definition: RoundDefinition): RoundDefinition {
  const where = `A rodada ${definition.id}`;
  for (const key of Object.keys(definition)) {
    if (!KNOWN_FIELDS.has(key)) {
      throw new UsageError(
        `${where} tem o campo desconhecido "${key}". Os campos são: ${[...KNOWN_FIELDS].join(', ')}.`,
      );
    }
  }
  if (!ID.test(definition.id)) {
    throw new UsageError(
      `O id da rodada ("${definition.id}") deve ter só letras minúsculas, números e hífens, como analise-programacao-revisao.`,
    );
  }
  if (definition.label?.trim().length === 0) {
    throw new UsageError(
      `${where} tem um label vazio: descreva a mudança ou tire o campo.`,
    );
  }
  if (definition.goal.trim().length === 0) {
    throw new UsageError(
      `${where} não diz o que quer identificar: preencha o goal.`,
    );
  }
  const actors = Object.keys(definition.actors);
  if (actors.length === 0) {
    throw new UsageError(`${where} não tem nenhum agente em actors.`);
  }
  if (definition.flow.length === 0) {
    throw new UsageError(`${where} não tem nenhum passo em flow.`);
  }
  definition.flow.forEach((step, index) => {
    for (const [field, name] of [
      ['actor', step.actor],
      ['by', step.by],
    ] as const) {
      if (name !== undefined && !actors.includes(name)) {
        throw new UsageError(
          `${where}: o passo ${String(index + 1)} usa ${field} "${name}", que não está em actors (${actors.join(', ')}).`,
        );
      }
    }
  });
  const inputs = Object.keys(definition.inputs ?? {});
  for (const [name, question] of Object.entries(definition.inputs ?? {})) {
    if (!INPUT.test(name)) {
      throw new UsageError(
        `${where}: o nome da pergunta "${name}" deve ter só letras minúsculas, números e hífens, como termo.`,
      );
    }
    if (question.trim().length === 0) {
      throw new UsageError(
        `${where}: inputs.${name} não diz o que perguntar: escreva a pergunta.`,
      );
    }
  }
  const named = [
    ...JSON.stringify(definition.criteria ?? {}).matchAll(INPUT_MARKER),
  ].map(([, name]) => name);
  for (const name of named) {
    if (!inputs.includes(name)) {
      throw new UsageError(
        `${where}: criteria usa {{input:${name}}}, mas inputs não tem a pergunta ${name}${inputs.length === 0 ? '' : ` (tem: ${inputs.join(', ')})`}.`,
      );
    }
  }
  for (const [name, list] of Object.entries(definition.criteria ?? {})) {
    if (name !== 'round' && !actors.includes(name)) {
      throw new UsageError(
        `${where}: criteria fala de "${name}", que não está em actors (${actors.join(', ')}) nem é "round".`,
      );
    }
    for (const criterion of list) {
      checkCriterion(criterion, `${where}: criteria.${name}`);
    }
  }
  const repeat = definition.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new UsageError(
      `${where}: repeat deve ser um inteiro a partir de 1, veio ${String(repeat)}.`,
    );
  }
  if (definition.start !== undefined) checkStart(definition.start, where);
  return definition;
}

/** A criterion of the declaration, checked: shape, paths and limits. */
/** The fields each part of a criterion takes; any other is refused. */
const CRITERION_FIELDS = {
  file: [
    'name',
    'ignore',
    'exists',
    'created',
    'deleted',
    'changed',
    'contains',
    'matches',
    'equals',
  ],
  limit: ['time', 'tokens', 'cost'],
  if: ['name', 'exists', 'contains'],
} as const;

/** A field `fields` does not have is a `UsageError` naming it and the known ones. */
function checkFields(
  value: object,
  fields: readonly string[],
  where: string,
): void {
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length > 0) {
    throw new UsageError(
      `${where}: ${unknown.map((key) => `"${key}"`).join(', ')} não é um campo daqui (os campos são ${fields.join(', ')}).`,
    );
  }
}

/**
 * A criterion is one kind only: `{ file }`, `{ limit }` or `{ if, check,
 * else }`. Two kinds in one object (a limit beside a file) would leave one
 * unchecked: each goes in an item of its own.
 */
function checkKind(criterion: RoundCriterion, where: string): void {
  const kinds = (['file', 'limit', 'if'] as const).filter(
    (kind) => kind in criterion,
  );
  if (kinds.length > 1) {
    throw new UsageError(
      `${where}: um critério tem um tipo só, e este tem ${kinds.join(' e ')}. Ponha cada um num item próprio da lista: ${kinds.map((kind) => `{ ${kind}: … }`).join(', ')}.`,
    );
  }
  if (kinds.length === 0) return;
  const kind = kinds[0];
  checkFields(
    criterion,
    kind === 'if' ? ['if', 'check', 'else'] : [kind],
    where,
  );
}

function checkCriterion(criterion: RoundCriterion, where: string): void {
  checkKind(criterion, where);
  if ('file' in criterion) {
    checkFields(criterion.file, CRITERION_FIELDS.file, `${where}.file`);
    const { file } = criterion;
    checkRelPath(file.name, `${where}.file.name`);
    for (const pattern of file.ignore ?? []) {
      checkRelPath(pattern, `${where}.file.ignore`);
    }
    for (const passage of file.contains ?? []) {
      if (passage.trim().length === 0) {
        throw new UsageError(`${where}.file.contains tem um trecho vazio.`);
      }
    }
    return;
  }
  if ('limit' in criterion) {
    checkFields(criterion.limit, CRITERION_FIELDS.limit, `${where}.limit`);
    const { time, tokens, cost } = criterion.limit;
    if (time !== undefined) {
      try {
        parseDuration(time);
      } catch {
        throw new UsageError(
          `${where}.limit.time inválido: "${time}" (use 20s, 2min, 1h).`,
        );
      }
    }
    if (tokens !== undefined && !(tokens > 0)) {
      throw new UsageError(
        `${where}.limit.tokens deve ser maior que zero, veio ${String(tokens)}.`,
      );
    }
    if (cost !== undefined && !(Number(cost) > 0)) {
      throw new UsageError(
        `${where}.limit.cost deve ser um valor em USD maior que zero, veio "${cost}".`,
      );
    }
    return;
  }
  if ('if' in criterion) {
    checkFields(criterion.if, CRITERION_FIELDS.if, `${where}.if`);
    checkRelPath(criterion.if.name, `${where}.if.name`);
    for (const inner of criterion.check) {
      checkCriterion(inner, `${where}.check`);
    }
    for (const inner of criterion.else ?? []) {
      checkCriterion(inner, `${where}.else`);
    }
    return;
  }
  throw new UsageError(`${where}: um critério precisa ter file, limit ou if.`);
}

/** A path relative to the workspace root (a wildcard is allowed). */
function checkRelPath(path: string, field: string): void {
  if (
    path.trim().length === 0 ||
    path.startsWith('/') ||
    path.split('/').includes('..')
  ) {
    throw new UsageError(
      `${field} deve ser um caminho relativo à raiz do workspace, como tickets/ticket-01.txt; veio "${path}".`,
    );
  }
}

function checkStart(start: RoundStartDefinition, where: string): void {
  const keys = Object.keys(start);
  if (keys.length !== 1 || !(keys[0] === 'fixture' || keys[0] === 'git')) {
    throw new UsageError(
      `${where}: start leva fixture (uma pasta de rounds/fixtures) ou git (root e tag de um repositório que já existe), um dos dois; veio ${keys.join(', ') || 'nada'}.`,
    );
  }
  if ('fixture' in start) {
    const name = start.fixture;
    if (
      name.trim().length === 0 ||
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..'
    ) {
      throw new UsageError(
        `${where}: start.fixture deve ser o nome de uma pasta de rounds/fixtures, como site-vazio; veio "${name}".`,
      );
    }
    return;
  }
  const { root, tag } = start.git;
  if (root.trim().length === 0 || tag.trim().length === 0) {
    throw new UsageError(
      `${where}: start.git precisa de root (o repositório do workspace) e tag (o ponto de partida).`,
    );
  }
}
