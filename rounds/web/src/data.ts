/**
 * The rounds' records (rounds/data), read at build time and checked by the
 * same validator the engine uses. A test is a declaration (its `id`, the
 * file in rounds/definitions); every time it runs is a round, numbered in
 * the order it ran, whatever changed in between. Each round is compared with
 * the one before it in the same test. Rounds with the same configuration
 * (the same `configHash`) are averaged together, and only those. Nothing
 * here is numbered by order: a test is its id, a configuration the start
 * of its hash, so they stay the same whatever records come or go.
 */

import { scoreRound, type RoundScore } from '../../../src/rounds/score';
import type { RoundRecord } from '../../../src/rounds/types';
import { validateRound } from '../../../src/rounds/validate';

export interface Test {
  /** The declaration's id: the test's address. */
  readonly key: string;
  /** The declaration's id. */
  readonly title: string;
  /** The goal of its last round: a declaration may change it. */
  readonly goal: string;
  /** Oldest first. */
  readonly rounds: readonly Round[];
  /** How many configurations its rounds ran with. */
  readonly configurations: number;
}

export interface Round {
  readonly record: RoundRecord;
  readonly test: Test;
  /** Its position among the test's rounds, from 1. */
  readonly index: number;
  /** `rodada 2 de 3`, or `rodada única`. */
  readonly label: string;
  /** Its configuration: the start of `configHash` (`674e600c`). */
  readonly configuration: string;
  /** The round before it in the same test: what it is compared with. */
  readonly previous: RoundRecord | undefined;
  /** Its scores, by the rubric, against the test's earlier rounds. */
  readonly score: RoundScore;
}

/** How many characters of `configHash` name a configuration. */
const CONFIG_KEY_LENGTH = 8;

// rounds/data (ROUNDS_DATA_DIR in src/rounds/constants.ts): Vite needs the
// glob as a literal, so the path is written here too.
const files = import.meta.glob<unknown>('../../data/*.json', {
  eager: true,
  import: 'default',
});

const records = Object.entries(files)
  .map(([path, value]) => validateRound(value, path.split('/').at(-1)))
  .toSorted((a, b) => a.timing.startedAt.localeCompare(b.timing.startedAt));

const groups = Map.groupBy(records, (record) => record.definition.id);

/** Built in two passes: a round points to its test, a test lists its rounds. */
const built: Test[] = [];
const allRounds: Round[] = [];
for (const [id, group] of groups) {
  const last = group.at(-1);
  if (last === undefined) continue;
  const rounds: Round[] = [];
  const test: Test = {
    key: id,
    title: id,
    goal: last.definition.goal,
    rounds,
    configurations: new Set(group.map((record) => record.configHash)).size,
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
      configuration: record.configHash.slice(0, CONFIG_KEY_LENGTH),
      previous: group[position - 1],
      score: scoreRound(record, group.slice(0, position)),
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
