/** Defaults of the logger. */

/**
 * Characters of an error's text kept in the log (`truncateError`, argument
 * `maxLength`): stack traces and npm logs can be huge; the head says what
 * went wrong.
 */
export const MAX_ERROR_LENGTH = 4000;

/**
 * The shortest value of a sensitive env that is masked wherever it appears
 * (`maskRecord`, argument `minSecretLength`). Shorter values (`1`, `true`)
 * would mask unrelated text.
 */
export const MIN_SECRET_LENGTH = 8;

/**
 * Permissions of a log file: only its owner reads it. Fixed: logs may hold
 * what the agent saw, and no option should open them to others.
 */
export const LOG_FILE_MODE = 0o600;
