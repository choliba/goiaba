import { pathToFileURL } from 'node:url';

import {
  modifiedAt,
  pathExists,
  dirname,
  isAbsolute,
  isWithin,
  join,
  realPathOfNearest,
  resolve,
} from '../filesystem/index';
import { UsageError } from '../errors';
import {
  LOGROTATE_COMPRESS,
  LOGROTATE_DAYS,
  LOGROTATE_MAX_FILE_SIZE,
  LOGROTATE_MAX_TOTAL_SIZE,
} from '../logger/constants';
import type { LogRotation } from '../logger/rotate';
import { parseSize, SIZE_EXAMPLES } from '../logger/size';
import {
  currentDirectory,
  environment,
  setEnvironmentDefault,
} from '../execute/process';
import {
  DEFAULT_DATABASE_DIR,
  DEFAULT_DATABASE_NAME,
  DEFAULT_HOMES_DIR,
  DEFAULT_LOG_DIR,
  DEFAULT_ROUNDS_DATA_DIR,
  DEFAULT_ROUNDS_DEFINITIONS_DIR,
  DEFAULT_ROUNDS_FIXTURES_DIR,
  DEFAULT_WORKSPACES_DIR,
} from './constants';

export interface GoiabaEnv {
  readonly [key: string]: string | boolean | number | undefined;
}

/** Where the SQLite database (sessions, decisions, approvals) is kept. */
export interface GoiabaDatabaseConfig {
  /** Directory, relative to the config file; defaults to `.goiaba`. */
  readonly dir?: string;
  /** File name; defaults to `goiaba.db`. */
  readonly name?: string;
}

/** What `logger.use` receives to open its files. */
export interface LoggerTarget {
  /** Absolute `logger.dir`. */
  readonly dir: string;
  /** Names this run's files: one log per open. */
  readonly session: string;
}

/**
 * Creates the log package's instance: pino, winston, LogTape or any object
 * with `debug/info/warn/error`. Swapping packages changes only this function.
 */
export type LoggerFactory = (target: LoggerTarget) => object;

/**
 * How the logs are kept: a session too long for one file goes on in the
 * next (`<sessão>.2.jsonl`), and old sessions are deleted (or compressed).
 * Each field left out takes its default (src/logger/constants.ts).
 */
export interface GoiabaLogRotateConfig {
  /** Soft limit of one file, with its unit (`'20mb'`): the record ends, the next goes on in a new file. */
  readonly maxFileSize?: string;
  /** Sessions older than this many days are deleted. */
  readonly days?: number;
  /** Past this size in the folder (`'200mb'`), the oldest sessions are deleted. */
  readonly maxTotalSize?: string;
  /** Ended sessions become `.jsonl.gz`. */
  readonly compress?: boolean;
}

export interface GoiabaLoggerConfig {
  /** Directory, relative to the config file; defaults to `.goiaba/logs`. */
  readonly dir?: string;
  /** Without it, Goiaba writes ECS JSONL in `dir` with no package. */
  readonly use?: LoggerFactory;
  /** Without it, every session stays, in one file. */
  readonly logrotate?: GoiabaLogRotateConfig;
}

/** The workspaces: where they are kept, and their CLIs' homes. */
export interface GoiabaWorkspacesConfig {
  /**
   * The default root of the agents' workspaces, relative to the config file
   * (or `~/…`); defaults to `.goiaba/workspaces`.
   */
  readonly dir?: string;
  /**
   * Where each workspace's home is kept (see `DEFAULT_HOMES_DIR`), relative
   * to the config file (or `~/…`); defaults to `.goiaba/homes`.
   */
  readonly homes?: string;
}

/** The rounds (src/rounds): where they run. */
export interface GoiabaRoundsConfig {
  /**
   * Where the rounds run, one folder per round (`<dir>/<id>`), recreated on
   * every run. Relative to the config file (or `~/…`). No default: a round
   * refuses to run without it. Must be outside the project, and must not
   * hold it: a round's folder is deleted before each run.
   */
  readonly dir?: string;
  /**
   * Where the rounds are declared (`<id>.ts` or `<id>/<id>.ts`). Relative to
   * the config file; `rounds/definitions` by default.
   */
  readonly definitions?: string;
  /** The starting points the rounds copy; `rounds/fixtures` by default. */
  readonly fixtures?: string;
  /** Where each run writes its record; `rounds/data` by default. */
  readonly data?: string;
}

export interface GoiabaConfig {
  readonly debug?: boolean;
  readonly logger?: GoiabaLoggerConfig;
  readonly database?: GoiabaDatabaseConfig;
  readonly workspaces?: GoiabaWorkspacesConfig;
  readonly rounds?: GoiabaRoundsConfig;
  readonly envs?: readonly GoiabaEnv[];
}

export interface ResolvedGoiabaEnv {
  readonly vars: Readonly<Record<string, string>>;
}

export interface ResolvedGoiabaConfig {
  readonly logger: {
    /** Absolute directory of the log. */
    readonly dir: string;
    readonly use: LoggerFactory | undefined;
    /** Every field filled in, sizes in bytes; `undefined` without `logger.logrotate`. */
    readonly logrotate: LogRotation | undefined;
  };
  /** Absolute path of the SQLite database file. */
  readonly databasePath: string;
  readonly workspaces: {
    /** Absolute default root of the agents' workspaces. */
    readonly dir: string;
    /** Absolute directory of the workspaces' homes. */
    readonly homes: string;
  };
  readonly rounds: {
    /** Absolute folder the rounds run in; `undefined` when not configured. */
    readonly dir: string | undefined;
    /** Absolute folder of the rounds' declarations. */
    readonly definitions: string;
    /** Absolute folder of the starting points (fixtures). */
    readonly fixtures: string;
    /** Absolute folder of the runs' records. */
    readonly data: string;
  };
  /**
   * The project: the folder of the config file (or where the search
   * started, without one). Records leave its path out (`<projeto>`).
   */
  readonly project: string;
  readonly debug: boolean;
  readonly configPath: string | undefined;
  readonly env: ResolvedGoiabaEnv | undefined;
  readonly envs: readonly ResolvedGoiabaEnv[];
}

export interface LoadConfigOptions {
  readonly cwd?: string;
  readonly path?: string;
}

export type GoiabaConfigFactory =
  GoiabaConfig | (() => GoiabaConfig | Promise<GoiabaConfig>);

const CONFIG_FILES = [
  'goiaba.config.ts',
  'goiaba.config.mts',
  'goiaba.config.js',
  'goiaba.config.mjs',
] as const;

const cache = new Map<string, Promise<ResolvedGoiabaConfig>>();
let current: ResolvedGoiabaConfig | undefined;

/**
 * Typed config. Not generic on purpose: an object literal checked against
 * `GoiabaConfig` gets excess-property errors (`databasePath` is flagged).
 */
// The object overload goes last: TypeScript reports the last one's error.
export function defineConfig(
  config: () => GoiabaConfig | Promise<GoiabaConfig>,
): () => GoiabaConfig | Promise<GoiabaConfig>;
export function defineConfig(config: GoiabaConfig): GoiabaConfig;
export function defineConfig(config: GoiabaConfigFactory): GoiabaConfigFactory {
  return config;
}

export function getConfig(): ResolvedGoiabaConfig {
  return current ?? resolveConfig({}, currentDirectory(), undefined);
}

export function isConfigLoaded(): boolean {
  return current !== undefined;
}

export function getEnv(): ResolvedGoiabaEnv {
  const env = getConfig().env;

  if (env === undefined) {
    throw new UsageError('Nenhum env ativo. Defina envs em goiaba.config.ts.');
  }

  return env;
}

export function clearConfigCache(): void {
  cache.clear();
  current = undefined;
}

export function loadConfig(
  options: LoadConfigOptions = {},
): Promise<ResolvedGoiabaConfig> {
  const cwd = resolve(options.cwd ?? currentDirectory());
  const key = `${cwd}::${options.path ?? ''}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const pending = readConfig(cwd, options.path).then((resolved) => {
    current = resolved;
    applyEnvVars(resolved.env?.vars ?? {});
    return resolved;
  });
  cache.set(key, pending);
  return pending;
}

async function readConfig(
  cwd: string,
  explicitPath: string | undefined,
): Promise<ResolvedGoiabaConfig> {
  const configPath =
    explicitPath === undefined
      ? findConfigFile(cwd)
      : resolve(cwd, explicitPath);

  if (configPath === undefined) {
    return resolveConfig({}, cwd, undefined);
  }

  if (!pathExists(configPath)) {
    throw new UsageError(`O arquivo de configuração ${configPath} não existe.`);
  }

  let source: unknown;

  try {
    const mtimeMs = modifiedAt(configPath);
    const href = `${pathToFileURL(configPath).href}?t=${mtimeMs}`;
    const module: unknown = await import(href);
    source = isRecord(module) ? module['default'] : undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Não foi possível carregar ${configPath}: ${reason}`);
  }

  const file = await normalizeConfig(source, configPath);
  return resolveConfig(file, dirname(configPath), configPath);
}

function findConfigFile(from: string): string | undefined {
  let dir = resolve(from);

  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = join(dir, name);

      if (pathExists(candidate)) {
        return candidate;
      }
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return undefined;
    }

    dir = parent;
  }
}

async function normalizeConfig(
  source: unknown,
  configPath: string,
): Promise<GoiabaConfig> {
  // A factory is untrusted user code: its result is validated below.
  const value: unknown =
    typeof source === 'function'
      ? await Promise.resolve(Reflect.apply(source, undefined, []))
      : source;

  if (!isRecord(value)) {
    throw new UsageError(
      `A configuração em ${configPath} deve exportar um objeto.`,
    );
  }

  rejectUnknownKeys(value, configPath);

  if (value['debug'] !== undefined && typeof value['debug'] !== 'boolean') {
    throw new UsageError(`debug em ${configPath} deve ser um boolean.`);
  }

  const database = normalizeDatabase(value['database'], configPath);
  const logger = normalizeLogger(value['logger'], configPath);
  const workspaces = normalizeWorkspaces(value['workspaces'], configPath);
  const rounds = normalizeRounds(value['rounds'], configPath);

  return {
    ...(value['debug'] === undefined ? {} : { debug: value['debug'] }),
    ...(database === undefined ? {} : { database }),
    ...(logger === undefined ? {} : { logger }),
    ...(workspaces === undefined ? {} : { workspaces }),
    ...(rounds === undefined ? {} : { rounds }),
    envs: normalizeEnvs(value['envs'], configPath),
  };
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'debug',
  'database',
  'envs',
  'logger',
  'rounds',
  'workspaces',
]);

/** Common mistakes, with the option meant. */
const RENAMED: Readonly<Partial<Record<string, string>>> = {
  databasePath: 'database: { dir, name }',
  database_path: 'database: { dir, name }',
  dbPath: 'database: { dir, name }',
  logDir: 'logger: { dir }',
  logsDir: 'logger: { dir }',
  env: 'envs',
  homes: 'workspaces: { homes }',
};

/** An unknown key is a typo or a renamed option: say so instead of ignoring it. */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  configPath: string,
): void {
  const unknown = Object.keys(value).find((key) => !KNOWN_KEYS.has(key));
  if (unknown === undefined) return;

  const hint = RENAMED[unknown];
  throw new UsageError(
    hint === undefined
      ? `Opção desconhecida "${unknown}" em ${configPath}. Opções: ${[...KNOWN_KEYS].join(', ')}.`
      : `Opção desconhecida "${unknown}" em ${configPath}. Use ${hint}.`,
  );
}

function normalizeLogger(
  logger: unknown,
  configPath: string,
): GoiabaLoggerConfig | undefined {
  if (logger === undefined) return undefined;

  if (!isRecord(logger)) {
    throw new UsageError(`logger em ${configPath} deve ser um objeto.`);
  }

  const unknown = Object.keys(logger).find(
    (key) => !LOGGER_OPTIONS.includes(key),
  );
  if (unknown !== undefined) {
    throw new UsageError(
      `Opção desconhecida "logger.${unknown}" em ${configPath}. Opções: ${LOGGER_OPTIONS.join(', ')}.`,
    );
  }

  const { dir, use } = logger;
  const logrotate = normalizeLogRotate(logger['logrotate'], configPath);

  if (dir !== undefined && (typeof dir !== 'string' || dir.trim() === '')) {
    throw new UsageError(
      `logger.dir em ${configPath} deve ser uma string não vazia.`,
    );
  }

  if (use !== undefined && !isLoggerFactory(use)) {
    throw new UsageError(
      `logger.use em ${configPath} deve ser uma função que cria o logger.`,
    );
  }

  return {
    ...(dir === undefined ? {} : { dir }),
    ...(use === undefined ? {} : { use }),
    ...(logrotate === undefined ? {} : { logrotate }),
  };
}

const LOGGER_OPTIONS: readonly string[] = ['dir', 'use', 'logrotate'];

const LOGROTATE_SIZES = ['maxFileSize', 'maxTotalSize'] as const;

const LOGROTATE_OPTIONS: readonly string[] = [
  ...LOGROTATE_SIZES,
  'days',
  'compress',
];

function normalizeLogRotate(
  value: unknown,
  configPath: string,
): GoiabaLogRotateConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new UsageError(
      `logger.logrotate em ${configPath} deve ser um objeto, como { days: 14 }.`,
    );
  }
  const unknown = Object.keys(value).find(
    (key) => !LOGROTATE_OPTIONS.includes(key),
  );
  if (unknown !== undefined) {
    throw new UsageError(
      `Opção desconhecida "logger.logrotate.${unknown}" em ${configPath}. Opções: ${LOGROTATE_OPTIONS.join(', ')}.`,
    );
  }
  for (const name of LOGROTATE_SIZES) {
    const size = value[name];
    if (
      size !== undefined &&
      (typeof size !== 'string' || parseSize(size) === undefined)
    ) {
      throw new UsageError(
        `logger.logrotate.${name} em ${configPath} deve ser um tamanho com a unidade, como ${SIZE_EXAMPLES} (k, kb, m, mb, g ou gb); veio ${JSON.stringify(size)}.`,
      );
    }
  }
  const days = value['days'];
  if (days !== undefined && !(typeof days === 'number' && days > 0)) {
    throw new UsageError(
      `logger.logrotate.days em ${configPath} deve ser um número maior que zero, veio ${JSON.stringify(days)}.`,
    );
  }
  if (
    value['compress'] !== undefined &&
    typeof value['compress'] !== 'boolean'
  ) {
    throw new UsageError(
      `logger.logrotate.compress em ${configPath} deve ser true ou false.`,
    );
  }
  // Checked above, field by field.
  return value;
}

/** A size already checked by `normalizeLogRotate`, in bytes. */
function sizeOf(text: string): number {
  const size = parseSize(text);
  if (size === undefined) throw new UsageError(`Tamanho inválido: ${text}.`);
  return size;
}

function isLoggerFactory(value: unknown): value is LoggerFactory {
  return typeof value === 'function';
}

function normalizeDatabase(
  database: unknown,
  configPath: string,
): GoiabaDatabaseConfig | undefined {
  if (database === undefined) return undefined;

  if (!isRecord(database)) {
    throw new UsageError(`database em ${configPath} deve ser um objeto.`);
  }

  const { dir, name } = database;

  if (dir !== undefined && (typeof dir !== 'string' || dir.trim() === '')) {
    throw new UsageError(
      `database.dir em ${configPath} deve ser uma string não vazia.`,
    );
  }

  if (name !== undefined && !isFileName(name)) {
    throw new UsageError(
      `database.name em ${configPath} deve ser um nome de arquivo, sem barras.`,
    );
  }

  return {
    ...(dir === undefined ? {} : { dir }),
    ...(name === undefined ? {} : { name }),
  };
}

function normalizeWorkspaces(
  workspaces: unknown,
  configPath: string,
): GoiabaWorkspacesConfig | undefined {
  if (workspaces === undefined) return undefined;

  if (!isRecord(workspaces)) {
    throw new UsageError(`workspaces em ${configPath} deve ser um objeto.`);
  }

  const unknown = Object.keys(workspaces).find(
    (key) => key !== 'dir' && key !== 'homes',
  );
  if (unknown !== undefined) {
    throw new UsageError(
      `Opção desconhecida "workspaces.${unknown}" em ${configPath}. Opções: dir, homes.`,
    );
  }

  const dir = workspacesPath(workspaces['dir'], 'dir', configPath);
  const homes = workspacesPath(workspaces['homes'], 'homes', configPath);

  return {
    ...(dir === undefined ? {} : { dir }),
    ...(homes === undefined ? {} : { homes }),
  };
}

/** The options of `rounds`, each a path. */
const ROUNDS_OPTIONS: readonly string[] = [
  'dir',
  'definitions',
  'fixtures',
  'data',
];

function normalizeRounds(
  rounds: unknown,
  configPath: string,
): GoiabaRoundsConfig | undefined {
  if (rounds === undefined) return undefined;

  if (!isRecord(rounds)) {
    throw new UsageError(`rounds em ${configPath} deve ser um objeto.`);
  }

  const unknown = Object.keys(rounds).find(
    (key) => !ROUNDS_OPTIONS.includes(key),
  );
  if (unknown !== undefined) {
    throw new UsageError(
      `Opção desconhecida "rounds.${unknown}" em ${configPath}. Opções: ${ROUNDS_OPTIONS.join(', ')}.`,
    );
  }

  const paths: Record<string, string> = {};
  for (const name of ROUNDS_OPTIONS) {
    const path = rounds[name];
    if (path === undefined) continue;
    if (typeof path !== 'string' || path.trim() === '') {
      throw new UsageError(
        `rounds.${name} em ${configPath} deve ser uma string não vazia.`,
      );
    }
    paths[name] = path;
  }
  return paths;
}

/**
 * `rounds.dir`, refused inside the project or holding it: a round's folder
 * is deleted before each run, and its git must never be the project's.
 * Compared by real paths, so a symlink does not hide either.
 */
function roundsDir(project: string, dir: string): string {
  const realProject = realPathOfNearest(project);
  const realDir = realPathOfNearest(dir);
  if (isWithin(realDir, realProject)) {
    throw new UsageError(
      `O rounds.dir (${dir}) está dentro do projeto (${project}). Use uma pasta fora dele, como ~/.local/share/goiaba/rodadas.`,
    );
  }
  if (isWithin(realProject, realDir)) {
    throw new UsageError(
      `O rounds.dir (${dir}) contém o projeto (${project}): a pasta de uma rodada é apagada antes de cada execução. Use uma pasta só das rodadas, como ~/.local/share/goiaba/rodadas.`,
    );
  }
  return dir;
}

function workspacesPath(
  path: unknown,
  name: string,
  configPath: string,
): string | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== 'string' || path.trim() === '') {
    throw new UsageError(
      `workspaces.${name} em ${configPath} deve ser uma string não vazia.`,
    );
  }
  return path;
}

function isFileName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  );
}

function normalizeEnvs(envs: unknown, configPath: string): GoiabaEnv[] {
  if (envs === undefined) {
    return [];
  }

  if (!Array.isArray(envs)) {
    throw new UsageError(`envs em ${configPath} deve ser um array.`);
  }

  return envs.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new UsageError(
        `envs[${String(index)}] em ${configPath} deve ser um objeto.`,
      );
    }

    return readEnvEntry(entry);
  });
}

function readEnvEntry(entry: Record<string, unknown>): GoiabaEnv {
  const env: Record<string, string | boolean | number | undefined> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      env[key] = value;
    }
  }

  return env;
}

function resolveConfig(
  file: GoiabaConfig,
  baseDir: string,
  configPath: string | undefined,
): ResolvedGoiabaConfig {
  const envOverrides = readEnvOverrides();
  const envs = (file.envs ?? []).map(resolveEnvEntry);

  return {
    logger: {
      dir: absolute(
        baseDir,
        envOverrides.logDir ?? file.logger?.dir ?? DEFAULT_LOG_DIR,
      ),
      use: file.logger?.use,
      logrotate:
        file.logger?.logrotate === undefined
          ? undefined
          : {
              maxFileBytes: sizeOf(
                file.logger.logrotate.maxFileSize ?? LOGROTATE_MAX_FILE_SIZE,
              ),
              days: file.logger.logrotate.days ?? LOGROTATE_DAYS,
              maxTotalBytes: sizeOf(
                file.logger.logrotate.maxTotalSize ?? LOGROTATE_MAX_TOTAL_SIZE,
              ),
              compress: file.logger.logrotate.compress ?? LOGROTATE_COMPRESS,
            },
    },
    databasePath: join(
      absolute(baseDir, file.database?.dir ?? DEFAULT_DATABASE_DIR),
      file.database?.name ?? DEFAULT_DATABASE_NAME,
    ),
    workspaces: {
      dir: absolute(baseDir, file.workspaces?.dir ?? DEFAULT_WORKSPACES_DIR),
      homes: absolute(baseDir, file.workspaces?.homes ?? DEFAULT_HOMES_DIR),
    },
    rounds: {
      dir:
        file.rounds?.dir === undefined
          ? undefined
          : roundsDir(baseDir, absolute(baseDir, file.rounds.dir)),
      definitions: absolute(
        baseDir,
        file.rounds?.definitions ?? DEFAULT_ROUNDS_DEFINITIONS_DIR,
      ),
      fixtures: absolute(
        baseDir,
        file.rounds?.fixtures ?? DEFAULT_ROUNDS_FIXTURES_DIR,
      ),
      data: absolute(baseDir, file.rounds?.data ?? DEFAULT_ROUNDS_DATA_DIR),
    },
    project: baseDir,
    debug: envOverrides.debug ?? file.debug ?? false,
    configPath,
    envs,
    env: envs[0],
  };
}

/** `path` from `baseDir`; `~/…` is the user's home. */
function absolute(baseDir: string, path: string): string {
  const home = environment()['HOME'];
  if (home !== undefined && (path === '~' || path.startsWith('~/'))) {
    return join(home, path.slice(2));
  }
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

function resolveEnvEntry(entry: GoiabaEnv): ResolvedGoiabaEnv {
  const vars: Record<string, string> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (typeof value === 'string') {
      vars[key] = value;
    }
  }

  return { vars };
}

function applyEnvVars(vars: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(vars)) {
    setEnvironmentDefault(key, value);
  }
}

function readEnvOverrides(): {
  readonly debug?: boolean;
  readonly logDir?: string;
} {
  const debug = parseFlag(environment()['GOIABA_DEBUG']);
  const logDir = environment()['GOIABA_LOG_DIR']?.trim();

  return {
    ...(debug === undefined ? {} : { debug }),
    ...(logDir === undefined || logDir.length === 0 ? {} : { logDir }),
  };
}

function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
