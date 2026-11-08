/**
 * The criteria of a good round, checked against the workspace (file criteria,
 * at the end of each step) and against what was measured (limit criteria,
 * after the round). Pure: it reads the workspace through a `Lookup`, so the
 * caller (`run`) adapts the real workspace and the tests pass fakes.
 *
 * Replaces the old `instructions` engine as it is wired in.
 */

import { HOUR_MS, MINUTE_MS, SECOND_MS } from './constants';
import type {
  Condition,
  CriterionResult,
  FileCriterion,
  LimitCriterion,
  RoundCriterion,
} from './types';

/** What the checker can read about the workspace at one moment. */
export interface Lookup {
  /** Whether the file exists (a directory does not count). */
  exists(name: string): boolean;
  /** The file's text, or `undefined` when it is absent or a directory. */
  read(name: string): string | undefined;
  /** Every file path, relative to the root (for wildcards). */
  list(): readonly string[];
}

/** What a limit criterion is compared with; `null` when not measured. */
export interface Measured {
  readonly ms: number | null;
  readonly tokens: number | null;
  readonly cost: number | null;
}

/** The workspace around a step, for file criteria. */
export interface FileContext {
  /** The workspace at the start of the step (for `if` and created/deleted). */
  readonly start: Lookup;
  /** The workspace at the end of the step. */
  readonly end: Lookup;
  /** Files the git saw change during the step, relative paths. */
  readonly changed: ReadonlySet<string>;
}

/**
 * The file (and conditional) criteria, checked against the workspace at the
 * end of a step. Limit criteria are left to `checkLimits` (they compare with
 * what was measured over the whole actor or round, known only later).
 */
export function checkFiles(
  criteria: readonly RoundCriterion[],
  context: FileContext,
): CriterionResult[] {
  return criteria.flatMap((criterion): CriterionResult[] => {
    if ('file' in criterion) return [checkFile(criterion.file, context)];
    if ('limit' in criterion) return [];
    const held = conditionHolds(criterion.if, context.start);
    return checkFiles(held ? criterion.check : (criterion.else ?? []), context);
  });
}

/** The top-level limit criteria, compared with what was measured. */
export function checkLimits(
  criteria: readonly RoundCriterion[],
  measured: Measured,
): CriterionResult[] {
  return criteria.flatMap((criterion) =>
    'limit' in criterion ? checkLimit(criterion.limit, measured) : [],
  );
}

// --- files ---

function checkFile(file: FileCriterion, context: FileContext): CriterionResult {
  const targets = targetsOf(file, context);
  const description = describeFile(file);

  if (targets.length === 0) {
    const met = !requiresPresence(file);
    return {
      description,
      met,
      detail: met
        ? `Nenhum arquivo em ${file.name}; nada a exigir.`
        : `Nenhum arquivo em ${file.name}.`,
    };
  }

  for (const target of targets) {
    const failure = fileFailure(file, target, context);
    if (failure !== undefined) {
      return { description, met: false, detail: failure };
    }
  }
  return { description, met: true, detail: `${description}.` };
}

/** The first assertion a target breaks, in words; `undefined` when it holds. */
function fileFailure(
  file: FileCriterion,
  target: string,
  { start, end, changed }: FileContext,
): string | undefined {
  const here = end.exists(target);
  if (file.exists === true && !here) return `${target} não existe.`;
  if (file.exists === false && here) return `${target} existe, mas não devia.`;
  if (file.created === true && !(end.exists(target) && !start.exists(target))) {
    return `${target} não foi criado no passo.`;
  }
  if (file.deleted === true && !(start.exists(target) && !end.exists(target))) {
    return `${target} não foi apagado no passo.`;
  }
  if (file.changed === true && !changed.has(target)) {
    return `${target} não mudou.`;
  }
  if (file.changed === false && changed.has(target)) {
    return `${target} mudou, mas não devia.`;
  }

  const content = end.read(target);
  const needsContent =
    file.contains !== undefined ||
    file.matches !== undefined ||
    file.equals !== undefined;
  if (needsContent && content === undefined) {
    return `${target} não existe para conferir o conteúdo.`;
  }
  const text = content ?? '';
  const lower = text.toLocaleLowerCase('pt-BR');
  for (const passage of file.contains ?? []) {
    if (!lower.includes(passage.toLocaleLowerCase('pt-BR'))) {
      return `${target} não contém "${passage}".`;
    }
  }
  for (const pattern of file.matches ?? []) {
    if (!asRegExp(pattern).test(text)) {
      return `${target} não casa ${String(asRegExp(pattern))}.`;
    }
  }
  if (file.equals !== undefined && text !== file.equals) {
    return `${target} não é exatamente o conteúdo esperado.`;
  }
  return undefined;
}

/** The files a criterion is about: the name, or every match of a wildcard. */
function targetsOf(file: FileCriterion, { start, end }: FileContext): string[] {
  if (!hasWildcard(file.name)) return [file.name];
  const all = new Set([...start.list(), ...end.list()]);
  const ignores = file.ignore ?? [];
  return [...all].filter(
    (name) =>
      matchGlob(name, file.name) &&
      !ignores.some((pattern) => matchGlob(name, pattern)),
  );
}

/** Whether the criterion can only hold if some file is there. */
function requiresPresence(file: FileCriterion): boolean {
  return (
    file.exists === true ||
    file.created === true ||
    file.changed === true ||
    file.contains !== undefined ||
    file.matches !== undefined ||
    file.equals !== undefined
  );
}

function describeFile(file: FileCriterion): string {
  const parts: string[] = [];
  if (file.exists === true) parts.push('existe');
  if (file.exists === false) parts.push('não existe');
  if (file.created === true) parts.push('foi criado');
  if (file.deleted === true) parts.push('foi apagado');
  if (file.changed === true) parts.push('mudou');
  if (file.changed === false) parts.push('não mudou');
  for (const passage of file.contains ?? []) parts.push(`contém "${passage}"`);
  for (const pattern of file.matches ?? []) {
    parts.push(`casa ${String(asRegExp(pattern))}`);
  }
  if (file.equals !== undefined) parts.push('tem o conteúdo exato');
  const what = parts.length === 0 ? 'existe' : parts.join(' e ');
  return `${file.name} ${what}`;
}

// --- limits ---

function checkLimit(
  limit: LimitCriterion,
  measured: Measured,
): CriterionResult[] {
  const results: CriterionResult[] = [];
  if (limit.time !== undefined) {
    const max = parseDuration(limit.time);
    results.push(
      compare('tempo', measured.ms, max, (ms) => showDuration(ms), limit.time),
    );
  }
  if (limit.tokens !== undefined) {
    results.push(
      compare(
        'tokens',
        measured.tokens,
        limit.tokens,
        (n) => String(Math.round(n)),
        String(limit.tokens),
      ),
    );
  }
  if (limit.cost !== undefined) {
    const max = Number(limit.cost);
    results.push(
      compare(
        'custo',
        measured.cost,
        max,
        (c) => `US$ ${c.toFixed(4)}`,
        `US$ ${limit.cost}`,
      ),
    );
  }
  return results;
}

function compare(
  what: string,
  value: number | null,
  max: number,
  show: (value: number) => string,
  maxLabel: string,
): CriterionResult {
  const description = `${what} dentro de ${maxLabel}`;
  if (value === null) {
    return { description, met: false, detail: `${what} não medido.` };
  }
  const met = value <= max;
  return {
    description,
    met,
    detail: met
      ? `${show(value)}, dentro de ${maxLabel}.`
      : `${show(value)}, acima de ${maxLabel}.`,
  };
}

// --- conditions ---

function conditionHolds(condition: Condition, start: Lookup): boolean {
  if (condition.exists === true && !start.exists(condition.name)) return false;
  if (condition.exists === false && start.exists(condition.name)) return false;
  const content = start.read(condition.name);
  const lower = (content ?? '').toLocaleLowerCase('pt-BR');
  for (const passage of condition.contains ?? []) {
    if (content === undefined) return false;
    if (!lower.includes(passage.toLocaleLowerCase('pt-BR'))) return false;
  }
  return true;
}

// --- helpers ---

function asRegExp(pattern: RegExp | string): RegExp {
  return typeof pattern === 'string' ? new RegExp(pattern) : pattern;
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/** Matches a relative path against a glob with `*`, `**` and `?`. */
export function matchGlob(name: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '') // placeholder (private use): any chars, slashes included
    .replace(/\*/g, '[^/]*')
    .replace(//g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${regex}$`).test(name);
}

/** `'20s'`, `'2min'`, `'1h'` → milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|min|h)$/.exec(text.trim());
  if (match === null) {
    throw new Error(`Duração inválida: "${text}" (use 20s, 2min, 1h).`);
  }
  const unit = match[2];
  const factor =
    unit === 's'
      ? SECOND_MS
      : unit === 'min'
        ? MINUTE_MS
        : unit === 'h'
          ? HOUR_MS
          : 1;
  return Number(match[1]) * factor;
}

function showDuration(ms: number): string {
  if (ms < SECOND_MS) return `${String(Math.round(ms))} ms`;
  const seconds = Math.round(ms / SECOND_MS);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0
    ? `${String(seconds)} s`
    : `${String(minutes)} min ${String(seconds % 60)} s`;
}
