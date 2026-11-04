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
