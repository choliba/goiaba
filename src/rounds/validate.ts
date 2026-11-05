/**
 * Checks that a value read from disk is a `RoundRecord`: every field, its
 * type, no unknown field, and that the parts agree with each other (every
 * agent a step names is in `actors`; the totals are the sum of `usage`).
 * Imports no runtime code of other modules, so the rounds' pages can use it.
 */

import { UsageError } from '../errors';
import { COST_TOLERANCE_USD } from './constants';
import { sum, TOKEN_KINDS } from './totals';
import {
  ROUND_SCHEMA,
  type CostSource,
  type RoundDecisionSource,
  type RoundHostState,
  type RoundWorkspaceType,
  type RoundRecord,
  type TokenCounts,
} from './types';

/** A check of one value, at `path`; throws when the value does not fit. */
type Check = (value: unknown, path: string) => void;

class Invalid extends Error {}

const invalid = (path: string, expected: string, value: unknown): Invalid =>
  new Invalid(`${path}: esperava ${expected}, veio ${describe(value)}`);

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'uma lista';
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40));
  if (typeof value === 'object') return 'um objeto';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const string: Check = (value, path) => {
  if (typeof value !== 'string') throw invalid(path, 'um texto', value);
};

const nonEmpty: Check = (value, path) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(path, 'um texto não vazio', value);
  }
};

const isoDate: Check = (value, path) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw invalid(path, 'uma data ISO', value);
  }
};

const boolean: Check = (value, path) => {
  if (typeof value !== 'boolean') throw invalid(path, 'true ou false', value);
};

const count: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid(path, 'um inteiro >= 0', value);
  }
};

const positive: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalid(path, 'um inteiro >= 1', value);
  }
};

const amount: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(path, 'um número >= 0', value);
  }
};

/** Any plain object: its shape is another module's to check (a policy). */
const anyObject: Check = (value, path) => {
  if (!isObject(value)) throw invalid(path, 'um objeto', value);
};

const nullable =
  (check: Check): Check =>
  (value, path) => {
    if (value !== null) check(value, path);
  };

/** One of the keys of `values`: a `Record<Union, true>`, so a new member must be added. */
const oneOf =
  (values: Readonly<Record<string, true>>): Check =>
  (value, path) => {
    if (typeof value !== 'string' || !Object.hasOwn(values, value)) {
      throw invalid(path, Object.keys(values).join(' | '), value);
    }
  };

const literal =
  (expected: number | string): Check =>
  (value, path) => {
    if (value !== expected)
      throw invalid(path, JSON.stringify(expected), value);
  };

const list =
  (check: Check): Check =>
  (value, path) => {
    if (!Array.isArray(value)) throw invalid(path, 'uma lista', value);
    value.forEach((item, index) => {
      check(item, `${path}[${String(index)}]`);
    });
  };

const record =
  (check: Check): Check =>
  (value, path) => {
    if (!isObject(value)) throw invalid(path, 'um objeto', value);
    for (const [key, item] of Object.entries(value)) {
      check(item, `${path}.${key}`);
    }
  };

/** Fields of an object; a key ending in `?` may be missing. Any other key is refused. */
const object =
  (shape: Readonly<Record<string, Check>>): Check =>
  (value, path) => {
    if (!isObject(value)) throw invalid(path, 'um objeto', value);
    const fields = value;
    const known = new Set<string>();
    for (const [spec, check] of Object.entries(shape)) {
      const optional = spec.endsWith('?');
      const key = optional ? spec.slice(0, -1) : spec;
      known.add(key);
      if (!Object.hasOwn(fields, key)) {
        if (!optional) throw new Invalid(`${path}.${key}: campo obrigatório`);
        continue;
      }
      check(fields[key], `${path}.${key}`);
    }
    for (const key of Object.keys(fields)) {
      if (!known.has(key))
        throw new Invalid(`${path}.${key}: campo desconhecido`);
    }
  };

const WORKSPACE_TYPES: Readonly<Record<RoundWorkspaceType, true>> = {
  docker: true,
  bubblewrap: true,
};

const HOST_STATES: Readonly<Record<RoundHostState, true>> = {
  login: true,
  none: true,
  share: true,
};

const DECISION_SOURCES: Readonly<Record<RoundDecisionSource, true>> = {
  policy: true,
  default: true,
  provider: true,
  human: true,
  saved: true,
};

const COST_SOURCES: Readonly<Record<CostSource, true>> = {
  cli: true,
  table: true,
};

const span = object({
  startedAt: isoDate,
  endedAt: isoDate,
  durationMs: count,
});

const tokens = object({
  input: nullable(count),
  output: nullable(count),
  cacheRead: nullable(count),
  cacheWrite: nullable(count),
  reasoning: nullable(count),
});

const usageTotal = object({ tokens, costUsd: nullable(amount) });

const check = object({
  passed: boolean,
  command: string,
  summary: string,
});

const actor = object({
  role: nonEmpty,
  provider: object({
    id: nonEmpty,
    name: nonEmpty,
    model: nonEmpty,
    cli: nullable(string),
    cliVersion: nullable(string),
    options: anyObject,
  }),
  workspace: object({
    type: oneOf(WORKSPACE_TYPES),
    image: nullable(string),
    root: nonEmpty,
    writable: list(string),
    hostState: oneOf(HOST_STATES),
    ports: list(count),
  }),
  network: object({
    rules: nullable(anyObject),
    alwaysAllow: list(string),
    alwaysDeny: list(string),
    decisions: list(
      object({
        ts: isoDate,
        destination: nonEmpty,
        protocol: oneOf({ http: true, https: true }),
        decision: oneOf({ allow: true, deny: true }),
        decidedBy: oneOf(DECISION_SOURCES),
        reason: string,
      }),
    ),
  }),
  policy: nullable(anyObject),
  readOnly: boolean,
  configHash: nonEmpty,
});

const step = object({
  actor: nonEmpty,
  by: nullable(nonEmpty),
  prompt: object({ text: string, hash: nonEmpty }),
  span,
  said: list(string),
  asked: list(string),
  turns: list(object({ index: positive, span })),
  tools: list(
    object({
      turn: positive,
      name: nonEmpty,
      detail: anyObject,
      outcome: oneOf({ result: true, error: true, unfinished: true }),
      span,
    }),
  ),
  changed: list(string),
  diff: string,
});

const roundRecord = object({
  schema: literal(ROUND_SCHEMA),
  id: nonEmpty,
  definition: object({ id: nonEmpty, 'title?': nonEmpty, goal: nonEmpty }),
  start: nullable(object({ tag: nonEmpty, commit: nonEmpty })),
  repeat: object({ index: positive, total: positive }),
  timing: object({
    startedAt: isoDate,
    endedAt: isoDate,
    durationMs: count,
    actors: record(
      object({
        startedAt: isoDate,
        endedAt: isoDate,
        durationMs: count,
        workspaceMs: nullable(count),
        gitCheckMs: nullable(count),
        approvalMs: nullable(count),
      }),
    ),
  }),
  actors: record(actor),
  configHash: nonEmpty,
  steps: list(step),
  usage: list(
    object({
      ts: isoDate,
      actor: nonEmpty,
      turn: positive,
      action: nullable(string),
      tokens,
      costUsd: nullable(amount),
      costSource: nullable(oneOf(COST_SOURCES)),
    }),
  ),
  totals: object({ round: usageTotal, actors: record(usageTotal) }),
  measures: record(
    object({
      turns: count,
      tools: count,
      questions: count,
      changedFiles: count,
      tests: nullable(check),
      typecheck: nullable(check),
    }),
  ),
  violations: list(
    object({
      rule: nonEmpty,
      actor: nullable(nonEmpty),
      passed: boolean,
      detail: string,
    }),
  ),
  'review?': object({
    title: nonEmpty,
    summary: string,
    steps: list(
      object({
        step: nullable(count),
        'lane?': nonEmpty,
        title: string,
        'text?': string,
        'ok?': string,
        'warn?': string,
      }),
    ),
    next: list(string),
  }),
});

/** Every agent the record names somewhere is one of `actors`. */
function checkActors(round: RoundRecord): void {
  const actors = new Set(Object.keys(round.actors));
  const named: [string, string | null][] = [
    ...round.steps.flatMap((s, i): [string, string | null][] => [
      [`steps[${String(i)}].actor`, s.actor],
      [`steps[${String(i)}].by`, s.by],
    ]),
    ...round.usage.map((u, i): [string, string] => [
      `usage[${String(i)}].actor`,
      u.actor,
    ]),
    ...round.violations.map((v, i): [string, string | null] => [
      `violations[${String(i)}].actor`,
      v.actor,
    ]),
    ...Object.keys(round.timing.actors).map((a): [string, string] => [
      `timing.actors.${a}`,
      a,
    ]),
    ...Object.keys(round.totals.actors).map((a): [string, string] => [
      `totals.actors.${a}`,
      a,
    ]),
    ...Object.keys(round.measures).map((a): [string, string] => [
      `measures.${a}`,
      a,
    ]),
  ];
  for (const [path, name] of named) {
    if (name !== null && !actors.has(name)) {
      throw new Invalid(`${path}: "${name}" não está em actors`);
    }
  }
  const stepCount = round.steps.length;
  round.review?.steps.forEach((note, i) => {
    if (note.step !== null && note.step >= stepCount) {
      throw new Invalid(
        `review.steps[${String(i)}].step: não há o passo ${String(note.step)}`,
      );
    }
  });
}

function sameTotal(
  total: { readonly tokens: TokenCounts; readonly costUsd: number | null },
  usage: RoundRecord['usage'],
  path: string,
): void {
  for (const kind of TOKEN_KINDS) {
    const expected = sum(usage.map((u) => u.tokens[kind]));
    if (total.tokens[kind] !== expected) {
      throw new Invalid(
        `${path}.tokens.${kind}: ${String(total.tokens[kind])}, mas a soma de usage é ${String(expected)}`,
      );
    }
  }
  const cost = sum(usage.map((u) => u.costUsd));
  const matches =
    cost === null || total.costUsd === null
      ? cost === total.costUsd
      : Math.abs(cost - total.costUsd) <= COST_TOLERANCE_USD;
  if (!matches) {
    throw new Invalid(
      `${path}.costUsd: ${String(total.costUsd)}, mas a soma de usage é ${String(cost)}`,
    );
  }
}

/** The totals are the sum of `usage`, for the round and for each agent. */
function checkTotals(round: RoundRecord): void {
  sameTotal(round.totals.round, round.usage, 'totals.round');
  for (const [name, total] of Object.entries(round.totals.actors)) {
    sameTotal(
      total,
      round.usage.filter((u) => u.actor === name),
      `totals.actors.${name}`,
    );
  }
}

/** Every field of a `RoundRecord`; throws `Invalid` at the first that does not fit. */
function isRound(value: unknown): value is RoundRecord {
  roundRecord(value, '$');
  return true;
}

/**
 * `value` as a `RoundRecord`, or a `UsageError` that says the first field
 * wrong and where (`<source>: steps[2].span.durationMs: …`).
 */
export function validateRound(value: unknown, source = 'rodada'): RoundRecord {
  try {
    if (!isRound(value)) throw new Invalid('$: não é uma rodada');
    checkActors(value);
    checkTotals(value);
    return value;
  } catch (error) {
    if (error instanceof Invalid) {
      throw new UsageError(
        `${source} não é uma rodada válida: ${error.message}`,
      );
    }
    throw error;
  }
}
