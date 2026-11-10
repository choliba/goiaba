/** Defaults of the project's configuration (`goiaba.config.ts`). */

/** Where the logs go, relative to the project (option `logger.dir`). */
export const DEFAULT_LOG_DIR = '.goiaba/logs';

/** Where the database lives, relative to the project (option `database.dir`). */
export const DEFAULT_DATABASE_DIR = '.goiaba';

/** The database file's name (option `database.name`). */
export const DEFAULT_DATABASE_NAME = 'goiaba.db';

/**
 * Where each workspace's home lives (option `workspaces.homes`): the home the CLIs
 * run with, instead of the user's (`~/.claude`, `~/.codex`, `~/.cursor`).
 * Next to the log and the database, and never visible in a sandbox.
 */
export const DEFAULT_HOMES_DIR = '.goiaba/homes';

/**
 * The default root of the agents' workspaces (option `workspaces.dir`): the
 * folder an agent works in, and what `bun run clear --workspaces` empties.
 * A `Workspace` may still be given any other root.
 */
export const DEFAULT_WORKSPACES_DIR = '.goiaba/workspaces';

/**
 * Where the rounds are declared, one `<id>.ts` or `<id>/<id>.ts` each
 * (option `rounds.definitions`), relative to the project.
 */
export const DEFAULT_ROUNDS_DEFINITIONS_DIR = 'rounds/definitions';

/** The starting points the rounds copy (option `rounds.fixtures`). */
export const DEFAULT_ROUNDS_FIXTURES_DIR = 'rounds/fixtures';

/** Where each run of a round writes its record (option `rounds.data`). */
export const DEFAULT_ROUNDS_DATA_DIR = 'rounds/data';
