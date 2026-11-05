/** What the index and a test's page say about several rounds at once. */

import type { RoundRecord } from '../../../src/rounds/types';
import { NOT_MEASURED, spread, sumTokens } from './format';

/** `27 s (22 s – 34 s)`: the mean, and the range when it varies. */
export function ranged(
  values: readonly (number | null)[],
  show: (value: number) => string,
): string {
  const s = spread(values);
  if (s === undefined) return NOT_MEASURED;
  return s.min === s.max
    ? show(s.mean)
    : `${show(s.mean)} (${show(s.min)} – ${show(s.max)})`;
}

/** `3,5`: a mean of counts. */
export const decimal = (value: number): string =>
  (Math.round(value * 10) / 10).toLocaleString('pt-BR');

/** Files the round's agents changed, as the git saw; `null` when nothing checked. */
export const changedFiles = (record: RoundRecord): number | null =>
  record.start === null
    ? null
    : Object.values(record.measures).reduce(
        (total, measures) => total + measures.changedFiles,
        0,
      );

export const roundTokens = (record: RoundRecord): number | null =>
  sumTokens(record.totals.round.tokens);

/** The rules of one round, in a few words. */
export function rulesOf(record: RoundRecord): string {
  if (record.start === null) return 'não conferidas';
  if (record.violations.length === 0) return 'nenhuma declarada';
  const failed = record.violations.filter((v) => !v.passed).length;
  return failed === 0
    ? `${String(record.violations.length)} cumpridas`
    : `${String(failed)} violada(s)`;
}
