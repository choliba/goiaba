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
 * The sum; one `null` (not measured) makes it `null`, and so does nothing to
 * sum: an agent always makes requests, so none recorded means its CLI does
 * not report them, not that it used 0 tokens.
 */
export function sum(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
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
    costUsd: sum(usage.map((u) => u.costUsd)),
  };
}
