/**
 * The record of a run: totals and counts made from the steps, cleaned of
 * what must not be committed, validated, and written as `<id>.json`.
 */

import { environment, userHome } from '../execute/process';
import { ensureDirectory, join, writeText } from '../filesystem/index';
import { CREDENTIAL_NAME, MIN_SECRET_LENGTH } from './constants';
import type { ActorMeasures, RoundRecord, RoundStep } from './types';
import { validateRound } from './validate';

/** The counts of one actor, over all its steps. */
export function measuresOf(steps: readonly RoundStep[]): ActorMeasures {
  return {
    turns: steps.reduce((total, step) => total + step.turns.length, 0),
    tools: steps.reduce((total, step) => total + step.tools.length, 0),
    questions: steps.reduce((total, step) => total + step.asked.length, 0),
    changedFiles: new Set(steps.flatMap((step) => step.changed)).size,
    tests: null,
    typecheck: null,
  };
}

/**
 * The text without the project's path (`<projeto>`), the home of whoever
 * ran it (`~`) or the value of any credential in the environment (its
 * name stays: `<CURSOR_API_KEY>`).
 */
export function sanitize(text: string, project: string): string {
  let clean = text;
  for (const [name, value] of Object.entries(environment())) {
    if (
      value !== undefined &&
      value.length >= MIN_SECRET_LENGTH &&
      CREDENTIAL_NAME.test(name)
    ) {
      clean = clean.replaceAll(value, `<${name}>`);
    }
  }
  clean = clean.replaceAll(project, '<projeto>');
  return clean.replaceAll(userHome(), '~');
}

/** Cleans, validates and writes the record in `dir`; the file's path. */
export function writeRound(
  round: RoundRecord,
  dir: string,
  project: string,
): string {
  const text = sanitize(`${JSON.stringify(round, null, 2)}\n`, project);
  const file = join(dir, `${round.id}.json`);
  validateRound(JSON.parse(text), file);
  ensureDirectory(dir);
  writeText(file, text);
  return file;
}
