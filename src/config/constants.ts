/** Defaults of the project's configuration (`goiaba.config.ts`). */

/** Where the logs go, relative to the project (option `logger.dir`). */
export const DEFAULT_LOG_DIR = '.goiaba/logs';

/** Where the database lives, relative to the project (option `database.dir`). */
export const DEFAULT_DATABASE_DIR = '.goiaba';

/** The database file's name (option `database.name`). */
export const DEFAULT_DATABASE_NAME = 'goiaba.db';

/**
 * Where each workspace's home lives (option `homes.dir`): the home the CLIs
 * run with, instead of the user's (`~/.claude`, `~/.codex`, `~/.cursor`).
 * Next to the log and the database, and never visible in a sandbox.
 */
export const DEFAULT_HOMES_DIR = '.goiaba/homes';
