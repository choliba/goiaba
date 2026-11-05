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
 */
export const RUBRIC = { best: 0.75, worst: 2, wastePenalty: 1 } as const;
