/**
 * The workspace's git, as a round uses it: back to the starting tag before
 * a run, and what changed around each agent.
 */

import { UsageError } from '../errors';
import { runProgram } from '../execute/process';
import {
  copyDirectory,
  dirname,
  ensureDirectory,
  isDirectory,
  isWithin,
  join,
  listDirectory,
  pathExists,
  realPathOfNearest,
  removePath,
} from '../filesystem/index';
import {
  FIXTURE_AUTHOR,
  FIXTURE_TAG,
  GIT_TIMEOUT_MS,
  ROUNDS_FIXTURES_DIR,
} from './constants';

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

/**
 * A round's folder must not be, hold or sit inside the project: its git is
 * reset and cleaned (or the folder deleted) before every run.
 */
export function assertApart(root: string, project: string): void {
  const realRoot = realPathOfNearest(root);
  const realProject = realPathOfNearest(project);
  if (isWithin(realRoot, realProject) || isWithin(realProject, realRoot)) {
    throw new UsageError(
      `A pasta da rodada (${root}) e o projeto (${project}) se sobrepõem: a rodada apaga e reinicia a pasta dela. Rode numa pasta fora do projeto (rounds.dir no goiaba.config.ts).`,
    );
  }
}

/**
 * `root` must be the top of its own repository: otherwise git climbs to the
 * repository around it, and the reset would land there.
 */
export async function assertOwnRepository(root: string): Promise<void> {
  const top = await git(root, 'rev-parse', '--show-toplevel').then(
    (text) => text.trim(),
    () => undefined,
  );
  if (top === undefined) {
    throw new UsageError(
      `A pasta da rodada (${root}) não é um repositório git. Crie um (git init) ou parta de uma fixture: start: { fixture: '…' }.`,
    );
  }
  if (realPathOfNearest(top) !== realPathOfNearest(root)) {
    throw new UsageError(
      `A pasta da rodada (${root}) não é a raiz de um repositório git: o git subiria até ${top}. Rode numa pasta com o próprio .git.`,
    );
  }
}

/**
 * A fresh folder for a round from `rounds/fixtures/<name>`: the old one
 * deleted, the fixture copied, its own repository created and tagged. Only
 * a direct child of `roundsDir` is ever deleted. The short commit.
 */
export async function prepareFixture({
  project,
  fixture,
  root,
  roundsDir,
}: {
  readonly project: string;
  readonly fixture: string;
  readonly root: string;
  readonly roundsDir: string;
}): Promise<string> {
  const fixtures = join(project, ROUNDS_FIXTURES_DIR);
  const source = join(fixtures, fixture);
  if (!pathExists(source) || !isDirectory(source)) {
    const available = pathExists(fixtures) ? listDirectory(fixtures) : [];
    throw new UsageError(
      `Não há a fixture ${fixture} em ${ROUNDS_FIXTURES_DIR}. ${available.length === 0 ? 'Não há nenhuma: crie a pasta com os arquivos de partida.' : `As que existem: ${available.join(', ')}.`}`,
    );
  }
  assertApart(root, project);
  if (dirname(realPathOfNearest(root)) !== realPathOfNearest(roundsDir)) {
    throw new UsageError(
      `A pasta da rodada (${root}) precisa ficar direto em rounds.dir (${roundsDir}): só ela é apagada antes de cada execução.`,
    );
  }
  removePath(root);
  ensureDirectory(root);
  copyDirectory(source, root);
  const author = [
    '-c',
    `user.name=${FIXTURE_AUTHOR.name}`,
    '-c',
    `user.email=${FIXTURE_AUTHOR.email}`,
  ];
  await git(root, 'init', '-q');
  await git(root, 'add', '-A');
  await git(
    root,
    ...author,
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    `Fixture ${fixture}`,
  );
  await git(root, 'tag', FIXTURE_TAG);
  await assertOwnRepository(root);
  return (await git(root, 'rev-parse', '--short', 'HEAD')).trim();
}

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
