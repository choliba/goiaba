/**
 * Sums of usage records. Pure, without other modules' runtime code: the
 * validator, and so the rounds' pages, use it too.
 */

import type { TokenCounts, UsageRecord, UsageTotal } from './types';

export const TOKEN_KINDS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
] as const satisfies readonly (keyof TokenCounts)[];

/**
 * The sum of what was measured; `null` when nothing was (no value, or all
 * `null`). A CLI reports tokens per request and the cost once per run, in
 * records of their own: each record leaves out what it does not carry.
 */
export function sum(values: readonly (number | null)[]): number | null {
  const measured = values.filter((value) => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((total, value) => total + value, 0);
}

/** The tokens and cost of `usage`, kind by kind. */
export function totalOf(usage: readonly UsageRecord[]): UsageTotal {
  const of = (kind: keyof TokenCounts): number | null =>
    sum(usage.map((u) => u.tokens[kind]));
  return {
    tokens: {
      input: of('input'),
      output: of('output'),
      cacheRead: of('cacheRead'),
      cacheWrite: of('cacheWrite'),
      reasoning: of('reasoning'),
    },
    fresh: sum(usage.map(freshOf)),
    costUsd: sum(usage.map((u) => u.costUsd)),
  };
}

/** The new tokens of one record: read minus cached, plus written. */
export function freshOf(record: UsageRecord): number | null {
  const { input, cacheRead, output } = record.tokens;
  if (input === null && output === null) return null;
  return (input ?? 0) - (cacheRead ?? 0) + (output ?? 0);
}
