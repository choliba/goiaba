import { UsageError } from '../../errors';
import { userHome } from '../../execute/process';
import {
  ensureDirectory,
  join,
  pathExists,
  readText,
  removePath,
  resolve,
} from '../../filesystem/index';
import type { HostAccess } from '../../providers/types';

/**
 * What of the host's CLI state reaches a sandbox (a workspace's `hostState`):
 *
 * - `login` (the default): none of it; the CLI runs with the workspace's own
 *   home, and only its login file comes in, read-only;
 * - `none`: none of it, not even the login: credentials come from the
 *   environment only;
 * - `share`: the CLI's state on the host (`~/.claude`, `~/.codex`,
 *   `~/.cursor`…), writable, with every project's history in it.
 */
export type HostState = 'login' | 'none' | 'share';

export const HOST_STATES: readonly HostState[] = ['login', 'none', 'share'];

/** A host file mounted somewhere else, read-only. */
export interface HostBind {
  readonly source: string;
  readonly destination: string;
}

/**
 * What of the host a sandbox lets in, decided before it starts: the CLI's
 * state (or a home of its own), its installation, its login, and its whole
 * environment. A secret not let in is not in the sandbox at all: not in a
 * variable, not in a file.
 */
export interface SandboxHost {
  /**
   * Host paths mounted writable (besides the workspace root). Never
   * Goiaba's cache: other agents' gates and old CLI homes live there; what
   * a sandbox needs of it (its gate, its network bridge) the sandbox mounts
   * on its own.
   */
  readonly state: readonly string[];
  /** Host paths mounted read-only: the CLI's installation. */
  readonly programs: readonly string[];
  /** Paths hidden in the sandbox: other logins, the other homes. */
  readonly hidden: readonly string[];
  /**
   * The workspace's home, mounted writable after `hidden` (it may be inside
   * a hidden path), with `credentials` mounted read-only into it.
   */
  readonly home: string | undefined;
  readonly credentials: readonly HostBind[];
  /** The CLI's environment, exactly. */
  readonly env: Readonly<Record<string, string>>;
}

export interface HostOptions {
  readonly hostState: HostState;
  /** Provider name, used to make missing-credential errors actionable. */
  readonly provider: string;
  /** This workspace's home (`Workspace.home()`). */
  readonly home: string;
  /** Where every workspace's home lives: never visible in a sandbox. */
  readonly homesDir: string;
  /** The workspace root: the homes are hidden when it contains them. */
  readonly root: string;
}

/** What every program needs to run: no secrets among them. */
const SYSTEM_ENV: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'TERM',
  'COLORTERM',
  'TZ',
  'TMPDIR',
  'NO_COLOR',
  'FORCE_COLOR',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
]);

/** The CLIs' logins on this machine: hidden unless the provider uses one. */
function knownCredentials(home: string): readonly string[] {
  return [
    join(home, '.claude/.credentials.json'),
    join(home, '.codex/auth.json'),
    join(home, '.config/cursor/auth.json'),
  ];
}

/**
 * The sandbox's share of the host for a provider: a home of its own (or,
 * with `share`, its state on the host), its credentials and nothing else;
 * plus the variables the policy lets it read (`secrets`).
 */
export function sandboxHost(
  access: HostAccess,
  source: NodeJS.ProcessEnv,
  allowSecret: (name: string) => boolean,
  options: HostOptions,
): SandboxHost {
  const hostHome = source['HOME'] ?? userHome();
  const env = allowedEnv(access, source, allowSecret);

  if (options.hostState === 'none') {
    requireEnvironmentCredential(access, source, options.provider);
  }

  if (options.hostState === 'share') {
    const state = access.sharedState;
    const hidden = knownCredentials(hostHome).filter(
      (file) =>
        !access.credentialFiles.includes(file) &&
        pathExists(file) &&
        state.some((path) => file === path || file.startsWith(`${path}/`)),
    );
    return {
      state,
      programs: access.programs ?? [],
      hidden: [...hidden, ...homesInside(options)],
      home: undefined,
      credentials: [],
      env,
    };
  }

  const { home } = options;
  ensureDirectory(home, 0o700);
  const credentials =
    options.hostState === 'login'
      ? loginBinds(access.credentialFiles, hostHome, home)
      : [];
  if (options.hostState === 'none') {
    removePlaceholders(access.credentialFiles, hostHome, home);
  }

  return {
    state: [],
    programs: access.programs ?? [],
    hidden: homesInside(options),
    home,
    credentials,
    env: { ...env, ...homeEnv(home, access.homeEnv ?? {}) },
  };
}

/** A credential file is deliberately unavailable in `none`; an env key must replace it. */
function requireEnvironmentCredential(
  access: HostAccess,
  source: NodeJS.ProcessEnv,
  provider: string,
): void {
  if (
    access.credentialEnv.length === 0 ||
    access.credentialEnv.some((name) => (source[name] ?? '').trim().length > 0)
  ) {
    return;
  }

  const alternatives = access.credentialEnv.join(', ');
  throw new UsageError(
    `O provider ${provider} precisa de uma destas variáveis com hostState: 'none': ${alternatives}. Configure uma delas no ambiente.`,
  );
}

/** The variables let in: the system's, the CLI's credentials, `secrets`. */
function allowedEnv(
  access: HostAccess,
  source: NodeJS.ProcessEnv,
  allowSecret: (name: string) => boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      SYSTEM_ENV.has(name) ||
      name.startsWith('LC_') ||
      access.credentialEnv.includes(name) ||
      allowSecret(name)
    ) {
      env[name] = value;
    }
  }
  return env;
}

/** Everything that says where a home is points to the workspace's. */
function homeEnv(
  home: string,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'),
  };
  for (const [name, path] of Object.entries(extra)) {
    const destination = join(home, path);
    ensureDirectory(destination, 0o700);
    env[name] = destination;
  }
  return env;
}

/** Each login file that exists, at the same place in the workspace's home. */
function loginBinds(
  files: readonly string[],
  hostHome: string,
  home: string,
): HostBind[] {
  const binds: HostBind[] = [];
  for (const source of files) {
    const relative = relativeTo(hostHome, source);
    if (relative === undefined || !pathExists(source)) continue;
    const destination = join(home, relative);
    ensureDirectory(join(destination, '..'), 0o700);
    binds.push({ source, destination });
  }
  return binds;
}

/**
 * Without the login, the empty files left where it was mounted before would
 * read as a broken login: removed. A file the CLI wrote itself stays.
 */
function removePlaceholders(
  files: readonly string[],
  hostHome: string,
  home: string,
): void {
  for (const source of files) {
    const relative = relativeTo(hostHome, source);
    if (relative === undefined) continue;
    const destination = join(home, relative);
    if (pathExists(destination) && readText(destination) === '') {
      removePath(destination);
    }
  }
}

/** The homes, when the workspace root holds them: hidden in its sandbox. */
function homesInside({ homesDir, root }: HostOptions): string[] {
  const resolvedRoot = resolve(root);
  const resolvedHomes = resolve(homesDir);
  return resolvedHomes === resolvedRoot ||
    resolvedHomes.startsWith(`${resolvedRoot}/`)
    ? [homesDir]
    : [];
}

function relativeTo(base: string, path: string): string | undefined {
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined;
}
