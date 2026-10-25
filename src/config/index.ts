import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { UsageError } from '../errors.js';

export interface GoiabaEnv {
  readonly [key: string]: string | boolean | number | undefined;
}

export interface GoiabaConfig {
  readonly logDir?: string;
  readonly debug?: boolean;
  readonly envs?: readonly GoiabaEnv[];
}

export interface ResolvedGoiabaEnv {
  readonly vars: Readonly<Record<string, string>>;
}

export interface ResolvedGoiabaConfig {
  readonly logDir: string;
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

const DEFAULT_LOG_DIR = '.goiaba/logs';

const cache = new Map<string, Promise<ResolvedGoiabaConfig>>();
let current: ResolvedGoiabaConfig | undefined;

export function defineConfig<T extends GoiabaConfigFactory>(config: T): T {
  return config;
}

export function getConfig(): ResolvedGoiabaConfig {
  return current ?? resolveConfig({}, process.cwd(), undefined);
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
  const cwd = resolve(options.cwd ?? process.cwd());
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

  if (!existsSync(configPath)) {
    throw new UsageError(`O arquivo de configuração ${configPath} não existe.`);
  }

  let source: unknown;

  try {
    const { mtimeMs } = statSync(configPath);
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

      if (existsSync(candidate)) {
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

  if (value['logDir'] !== undefined && typeof value['logDir'] !== 'string') {
    throw new UsageError(`logDir em ${configPath} deve ser uma string.`);
  }

  if (value['debug'] !== undefined && typeof value['debug'] !== 'boolean') {
    throw new UsageError(`debug em ${configPath} deve ser um boolean.`);
  }

  return {
    ...(value['logDir'] === undefined ? {} : { logDir: value['logDir'] }),
    ...(value['debug'] === undefined ? {} : { debug: value['debug'] }),
    envs: normalizeEnvs(value['envs'], configPath),
  };
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
  const logDir = envOverrides.logDir ?? file.logDir ?? DEFAULT_LOG_DIR;
  const envs = (file.envs ?? []).map(resolveEnvEntry);

  return {
    logDir: isAbsolute(logDir) ? logDir : resolve(baseDir, logDir),
    debug: envOverrides.debug ?? file.debug ?? false,
    configPath,
    envs,
    env: envs[0],
  };
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
    process.env[key] ??= value;
  }
}

function readEnvOverrides(): {
  readonly debug?: boolean;
  readonly logDir?: string;
} {
  const debug = parseFlag(process.env['GOIABA_DEBUG']);
  const logDir = process.env['GOIABA_LOG_DIR']?.trim();

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
