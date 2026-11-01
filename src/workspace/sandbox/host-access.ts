import { homedir } from 'node:os';

import { environment } from '../../execute/process';
import { join, pathExists, goiabaCacheDir } from '../../filesystem/index';
import type { HostAccess } from '../../providers/types';

/**
 * What of the host a sandbox lets in, decided before it starts: the CLI's
 * state paths, the credential files to hide among them, and its whole
 * environment. A secret not let in is not in the sandbox at all: not in a
 * variable, not in a file.
 */
export interface SandboxHost {
  /** Host paths mounted writable (besides the workspace root). */
  readonly state: readonly string[];
  /** Credential files inside `state` the CLI does not need: hidden. */
  readonly hidden: readonly string[];
  /** The CLI's environment, exactly. */
  readonly env: Readonly<Record<string, string>>;
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
  ];
}

/**
 * The sandbox's share of the host for a provider: its state (and Goiaba's
 * own cache, where the gate and the network bridge live), its credentials
 * and nothing else; plus the variables the policy lets it read (`secrets`).
 */
export function sandboxHost(
  access: HostAccess,
  source: NodeJS.ProcessEnv,
  allowSecret: (name: string) => boolean,
): SandboxHost {
  const home = source['HOME'] ?? homedir();
  const state = [...access.state, goiabaCacheDir(environment())];
  const hidden = knownCredentials(home).filter(
    (file) =>
      !access.credentialFiles.includes(file) &&
      pathExists(file) &&
      state.some((path) => file === path || file.startsWith(`${path}/`)),
  );

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

  return { state, hidden, env };
}
