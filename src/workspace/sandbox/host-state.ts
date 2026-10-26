import { homedir } from 'node:os';

import { environment } from '../../execute/process';
import { join } from '../../filesystem/index';

/**
 * Directories where host CLIs keep credentials, cache and policy files.
 * The sandbox filesystem is otherwise read-only.
 */
export function hostStateDirs(
  env: NodeJS.ProcessEnv = environment(),
): readonly string[] {
  const home = env['HOME'] ?? homedir();

  return [
    xdgDir(env['XDG_CONFIG_HOME']) ?? join(home, '.config'),
    xdgDir(env['XDG_CACHE_HOME']) ?? join(home, '.cache'),
    xdgDir(env['XDG_DATA_HOME']) ?? join(home, '.local/share'),
    join(home, '.cursor'),
    join(home, '.codex'),
    join(home, '.claude'),
    join(home, '.claude.json'),
  ];
}

/** XDG treats an empty variable as unset. */
function xdgDir(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
