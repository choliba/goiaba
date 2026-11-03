import { pathToFileURL } from 'node:url';

import {
  modifiedAt,
  pathExists,
  dirname,
  isAbsolute,
  join,
  resolve,
} from '../filesystem/index';
import { UsageError } from '../errors';
import {
  currentDirectory,
  environment,
  setEnvironmentDefault,
} from '../execute/process';
import {
  DEFAULT_DATABASE_DIR,
  DEFAULT_DATABASE_NAME,
  DEFAULT_LOG_DIR,
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

export interface GoiabaLoggerConfig {
  /** Directory, relative to the config file; defaults to `.goiaba/logs`. */
  readonly dir?: string;
  /** Without it, Goiaba writes ECS JSONL in `dir` with no package. */
  readonly use?: LoggerFactory;
}

export interface GoiabaConfig {
  readonly debug?: boolean;
  readonly logger?: GoiabaLoggerConfig;
  readonly database?: GoiabaDatabaseConfig;
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
  };
  /** Absolute path of the SQLite database file. */
  readonly databasePath: string;
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

  return {
    ...(value['debug'] === undefined ? {} : { debug: value['debug'] }),
    ...(database === undefined ? {} : { database }),
    ...(logger === undefined ? {} : { logger }),
    envs: normalizeEnvs(value['envs'], configPath),
  };
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'debug',
  'database',
  'envs',
  'logger',
]);

/** Common mistakes, with the option meant. */
const RENAMED: Readonly<Partial<Record<string, string>>> = {
  databasePath: 'database: { dir, name }',
  database_path: 'database: { dir, name }',
  dbPath: 'database: { dir, name }',
  logDir: 'logger: { dir }',
  logsDir: 'logger: { dir }',
  env: 'envs',
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

  const { dir, use } = logger;

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
  };
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
    },
    databasePath: join(
      absolute(baseDir, file.database?.dir ?? DEFAULT_DATABASE_DIR),
      file.database?.name ?? DEFAULT_DATABASE_NAME,
    ),
    debug: envOverrides.debug ?? file.debug ?? false,
    configPath,
    envs,
    env: envs[0],
  };
}

function absolute(baseDir: string, path: string): string {
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
