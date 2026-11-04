/**
 * The rounds' records (rounds/data), read at build time and checked by the
 * same validator the engine uses. Each run gets its number: a new one for
 * each new configuration, in the order they first ran; repetitions of a
 * configuration share it (`3 · 2/2`).
 */

import type { RoundRecord } from '../../../src/rounds/types';
import { validateRound } from '../../../src/rounds/validate';

export interface Round {
  readonly record: RoundRecord;
  /** `3`, or `3 · 2/2` for a repetition. */
  readonly label: string;
  /** The configuration's number: the same for its repetitions. */
  readonly number: number;
  /** The run before this one, to say what changed. */
  readonly previous: RoundRecord | undefined;
}

const files = import.meta.glob<unknown>('../../data/*.json', {
  eager: true,
  import: 'default',
});

const records = Object.entries(files)
  .map(([path, value]) => validateRound(value, path.split('/').at(-1)))
  .toSorted((a, b) => a.timing.startedAt.localeCompare(b.timing.startedAt));

const numbers = new Map<string, number>();
for (const record of records) {
  if (!numbers.has(record.configHash)) {
    numbers.set(record.configHash, numbers.size + 1);
  }
}

export const rounds: readonly Round[] = records.map((record, index) => {
  const number = numbers.get(record.configHash) ?? 0;
  const { index: k, total } = record.repeat;
  return {
    record,
    number,
    label:
      total > 1
        ? `${String(number)} · ${String(k)}/${String(total)}`
        : String(number),
    previous: records[index - 1],
  };
});

export const roundById = (id: string): Round | undefined =>
  rounds.find((round) => round.record.id === id);
