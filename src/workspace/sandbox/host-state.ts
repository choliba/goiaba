import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Directories where host CLIs keep credentials, cache and policy files.
 * The sandbox filesystem is otherwise read-only.
 */
export function hostStateDirs(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const home = env.HOME ?? homedir();

  return [
    env.XDG_CONFIG_HOME || join(home, '.config'),
    env.XDG_CACHE_HOME || join(home, '.cache'),
    env.XDG_DATA_HOME || join(home, '.local/share'),
    join(home, '.cursor'),
    join(home, '.codex'),
  ];
}
