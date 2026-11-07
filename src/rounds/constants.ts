/** Values of the rounds. */

/**
 * How far, in USD, a total cost may differ from the sum of its usage records
 * and still count as equal: float rounding of a few hundred additions, far
 * below any real price (a token costs ~1e-7 USD).
 */
export const COST_TOLERANCE_USD = 1e-9;

/** How long a git command of a round may take, in ms: all local and small. */
export const GIT_TIMEOUT_MS = 30_000;

/** Environment variables whose value is a secret, by name. */
export const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASS|AUTH|CREDENTIAL/i;

/** Values shorter than this are not replaced: they would match common text. */
export const MIN_SECRET_LENGTH = 12;

/**
 * What an agent gets when it asks something during a round: nobody answers
 * there. Shown to the agent, so in the user's language.
 */
export const NO_ONE_ANSWERS =
  'Ninguém vai responder nesta rodada. Decida você, escolhendo a opção mais simples, diga qual escolheu e siga.';

/**
 * The rubric's numbers (src/rounds/score.ts, rounds/README.md). Resources
 * are scored against the test's reference (the median of earlier rounds):
 * - `best`: at or under this share of the reference, 5. A quarter less is
 *   already a clear gain, not noise between two runs;
 * - `worst`: at or over this multiple, 0. Twice the time or tokens is a
 *   clear loss;
 * - the reference itself scores 3: as good as usual, not better.
 * `wastePenalty`: points off the process score (from 5) for each question,
 * tool error or denied attempt: five wasted steps and it is 0.
 * `weights`: of the final score. The result weighs more than the means
 * (60/40): delivering matters more than how cheaply; the two add up to 1.
 */
export const RUBRIC = {
  best: 0.75,
  worst: 2,
  wastePenalty: 1,
  weights: { effectiveness: 0.6, efficiency: 0.4 },
} as const;

/**
 * Where a round's pieces live in the project, relative to its root. Part of
 * the repository's layout, versioned and read by the pages, so not options:
 * the declarations, the starting points (fixtures) and the records.
 */
export const ROUNDS_DEFINITIONS_DIR = 'rounds/definitions';
export const ROUNDS_FIXTURES_DIR = 'rounds/fixtures';
export const ROUNDS_DATA_DIR = 'rounds/data';

/**
 * The tag a fixture's repository is created with: the point every run of a
 * round started from a fixture goes back to. Internal: nobody tags by hand.
 */
export const FIXTURE_TAG = 'rodada-base';

/**
 * Who commits a fixture's starting point: set on the command, so creating
 * it does not depend on the user's git identity (nor leaks it).
 */
export const FIXTURE_AUTHOR = { name: 'goiaba', email: 'goiaba@localhost' };

/**
 * Where the rounds' pages answer while `bun run rounds:web` runs: Vite's
 * dev server, on its default port. A round's page is this plus
 * `#/rodada/<id>`.
 */
export const ROUNDS_WEB_URL = 'http://localhost:5173/';

/**
 * Milliseconds to wait for the pages to answer before saying they are not
 * up: a local server answers in a few; more would only delay the end of
 * the round.
 */
export const ROUNDS_WEB_PROBE_MS = 1000;

/** The rounds' pages: the Vite project `bun run rounds:web` serves. */
export const ROUNDS_WEB_DIR = 'rounds/web';

/** Vite's own script, in the pages' project: run directly, one process to stop. */
export const ROUNDS_WEB_VITE = 'node_modules/vite/bin/vite.js';

/**
 * Milliseconds to wait for the pages' server to answer once started: Vite
 * starts in about one second; more than this, something is wrong (a busy
 * port, no dependencies installed).
 */
export const ROUNDS_WEB_START_MS = 15_000;

/** Milliseconds between checks while the pages' server starts. */
export const ROUNDS_WEB_POLL_MS = 250;
