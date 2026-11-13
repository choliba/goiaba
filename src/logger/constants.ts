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

/**
 * `logger.logrotate.maxFileSize`, a size with its unit (src/logger/size.ts):
 * past it, the session goes on in a new file (`<sessão>.2.jsonl`). A soft
 * limit: the record being written ends where it is, so a file can pass it
 * by one record. 20 MB is hours of a debug session and still opens in an
 * editor.
 */
export const LOGROTATE_MAX_FILE_SIZE = '20mb';

/**
 * `logger.logrotate.days`: sessions older than this, in days, are deleted
 * when a new one opens. Two weeks keeps what is still being looked into.
 */
export const LOGROTATE_DAYS = 14;

/**
 * `logger.logrotate.maxTotalSize`, a size with its unit: past it, the
 * oldest sessions are deleted until the folder fits. 200 MB is ten full
 * files.
 */
export const LOGROTATE_MAX_TOTAL_SIZE = '200mb';

/**
 * `logger.logrotate.compress`: whether ended sessions become `.jsonl.gz`.
 * Off by default: the logs are read in an editor and with grep.
 */
export const LOGROTATE_COMPRESS = false;
