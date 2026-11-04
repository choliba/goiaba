/**
 * The rounds' records (rounds/data), read at build time and checked by the
 * same validator the engine uses, grouped into tests: a test is one
 * configuration (the same agents, id and goal: the same `configHash`), and
 * each of its runs is a round. Tests are numbered in the order they first
 * ran; a test's rounds, in the order they ran (`teste 3 · rodada 2 de 2`),
 * whether they ran together (`repeat`) or on different days.
 */

import type { RoundRecord } from '../../../src/rounds/types';
import { validateRound } from '../../../src/rounds/validate';

export interface Test {
  /** In the order tests first ran, from 1. */
  readonly number: number;
  /** The start of `configHash`: the test's address. */
  readonly key: string;
  readonly configHash: string;
  /** Its first round's review title, or the declaration's id. */
  readonly title: string;
  readonly definition: RoundRecord['definition'];
  /** Oldest first. */
  readonly rounds: readonly Round[];
  /** The test that ran before this one, to say what changed. */
  readonly previous: Test | undefined;
}

export interface Round {
  readonly record: RoundRecord;
  readonly test: Test;
  /** Its position among the test's rounds, from 1. */
  readonly index: number;
  /** `rodada 2 de 2`, or `rodada única`. */
  readonly label: string;
  /** The round that ran before this one, in any test. */
  readonly previous: RoundRecord | undefined;
}

/** How many characters of `configHash` make a test's address. */
const KEY_LENGTH = 12;

const files = import.meta.glob<unknown>('../../data/*.json', {
  eager: true,
  import: 'default',
});

const records = Object.entries(files)
  .map(([path, value]) => validateRound(value, path.split('/').at(-1)))
  .toSorted((a, b) => a.timing.startedAt.localeCompare(b.timing.startedAt));

const groups = Map.groupBy(records, (record) => record.configHash);

/** Built in two passes: a round points to its test, a test lists its rounds. */
const built: Test[] = [];
const allRounds: Round[] = [];
for (const [configHash, group] of groups) {
  const first = group[0];
  if (first === undefined) continue;
  const rounds: Round[] = [];
  const test: Test = {
    number: built.length + 1,
    key: configHash.slice(0, KEY_LENGTH),
    configHash,
    title: first.review?.title ?? first.definition.id,
    definition: first.definition,
    rounds,
    previous: built.at(-1),
  };
  group.forEach((record, position) => {
    rounds.push({
      record,
      test,
      index: position + 1,
      label:
        group.length === 1
          ? 'rodada única'
          : `rodada ${String(position + 1)} de ${String(group.length)}`,
      previous: records[records.indexOf(record) - 1],
    });
  });
  built.push(test);
  allRounds.push(...rounds);
}

/** Oldest first. */
export const tests: readonly Test[] = built;

/** The tests by their last round, newest first: what the top shows. */
export const recentTests: readonly Test[] = tests.toSorted((a, b) =>
  lastRun(b).localeCompare(lastRun(a)),
);

export function lastRun(test: Test): string {
  return test.rounds.at(-1)?.record.timing.startedAt ?? '';
}

export const roundById = (id: string): Round | undefined =>
  allRounds.find((round) => round.record.id === id);

export const testByKey = (key: string): Test | undefined =>
  tests.find((test) => test.key === key);
