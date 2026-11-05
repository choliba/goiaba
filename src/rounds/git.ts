/**
 * The workspace's git, as a round uses it: back to the starting tag before
 * a run, and what changed around each agent.
 */

import { UsageError } from '../errors';
import { runProgram } from '../execute/process';
import { GIT_TIMEOUT_MS } from './constants';

/** The workspace's state in git, to know whether an agent changed something. */
export interface Tree {
  /** The lines of `git status --porcelain`. */
  readonly status: readonly string[];
  readonly diff: string;
  /** Changes whenever any file changes, also one not yet in git. */
  readonly key: string;
}

const git = (root: string, ...args: string[]): Promise<string> =>
  runProgram('git', ['-C', root, ...args], { timeoutMs: GIT_TIMEOUT_MS });

const lines = (text: string): string[] =>
  text.split('\n').filter((line) => line.length > 0);

/** Back to `tag`, without what the last run left; the short commit. */
export async function resetTo(root: string, tag: string): Promise<string> {
  try {
    await git(root, 'rev-parse', '--verify', '--quiet', `${tag}^{commit}`);
  } catch {
    throw new UsageError(
      `O workspace (${root}) não tem a tag ${tag}. Marque o ponto de partida das rodadas: git -C ${root} tag ${tag} <commit>`,
    );
  }
  await git(root, 'checkout', '--force', '--detach', tag);
  // Without -x: what .gitignore ignores (node_modules, dist) stays.
  await git(root, 'clean', '-fd');
  return (await git(root, 'rev-parse', '--short', 'HEAD')).trim();
}

export async function tree(root: string): Promise<Tree> {
  const status = lines(await git(root, 'status', '--porcelain=v1', '-uall'));
  const diff = await git(root, 'diff', 'HEAD');
  const untracked = lines(
    await git(root, 'ls-files', '--others', '--exclude-standard'),
  );
  const hashes =
    untracked.length === 0
      ? ''
      : await git(root, 'hash-object', '--', ...untracked);
  return { status, diff, key: `${status.join('\n')}\n${diff}\n${hashes}` };
}

/** What changed from `before` to `after`: the status lines and the diff. */
export function changes(
  before: Tree,
  after: Tree,
): { readonly changed: readonly string[]; readonly diff: string } {
  if (after.key === before.key) return { changed: [], diff: '' };
  const added = after.status.filter((line) => !before.status.includes(line));
  // A file already changed and changed again keeps its line.
  return { changed: added.length > 0 ? added : after.status, diff: after.diff };
}

/**
 * How many lines `path` had at `tag`; `undefined` when it did not exist
 * there (or is not a file).
 */
export async function linesAt(
  root: string,
  tag: string,
  path: string,
): Promise<number | undefined> {
  try {
    const text = await git(root, 'show', `${tag}:${path.replace(/^\.\//, '')}`);
    return text.endsWith('\n')
      ? text.split('\n').length - 1
      : text.split('\n').length;
  } catch {
    return undefined;
  }
}
