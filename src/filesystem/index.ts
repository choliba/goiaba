import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

/**
 * Disk access. Nothing else imports `node:fs`: what goes to the disk goes
 * through here, the same way processes go through `execute` and messages to
 * the user through `output`.
 */

/**
 * Path text (no disk access), from here too: nothing else imports
 * `node:path` either.
 */
export {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';

export function pathExists(path: string): boolean {
  return existsSync(path);
}

export function isDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

export function isSymlink(path: string): boolean {
  return lstatSync(path).isSymbolicLink();
}

/** Last modification time, in milliseconds. */
export function modifiedAt(path: string): number {
  return statSync(path).mtimeMs;
}

export function readLink(path: string): string {
  return readlinkSync(path);
}

/** Absolute path with every symlink resolved. */
export function realPath(path: string): string {
  return realpathSync(path);
}

/**
 * `realPath` of a path that may not exist yet: the nearest existing
 * ancestor resolved, with the missing rest appended as written.
 */
export function realPathOfNearest(path: string): string {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}

/** Whether `path` is `dir` or inside it, by the text of both (absolute). */
export function isWithin(path: string, dir: string): boolean {
  const fromDir = relative(dir, path);
  return (
    fromDir === '' ||
    (fromDir !== '..' && !fromDir.startsWith('../') && !isAbsolute(fromDir))
  );
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Everything readable from an open file descriptor, as text: `0` is stdin
 * (the request a hook receives, a piped input).
 */
export function readDescriptor(descriptor: number): string {
  return readFileSync(descriptor, 'utf8');
}

export function listDirectory(path: string): string[] {
  return readdirSync(path);
}

/** Whether `path` can be opened for reading by this process. */
export function canOpen(path: string): boolean {
  try {
    closeSync(openSync(path, 'r'));
    return true;
  } catch {
    return false;
  }
}

/** Creates the directory and its parents, if missing. */
export function ensureDirectory(path: string, mode?: number): void {
  mkdirSync(path, { recursive: true, ...(mode === undefined ? {} : { mode }) });
}

export function writeText(path: string, content: string, mode?: number): void {
  writeFileSync(path, content, mode === undefined ? {} : { mode });
}

/** `mode` applies when the file is created. */
export function appendText(path: string, content: string, mode?: number): void {
  appendFileSync(path, content, { mode });
}

export function createSymlink(target: string, path: string): void {
  symlinkSync(target, path);
}

/** Copies a directory tree into `to`, which is created if missing. */
export function copyDirectory(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

/** Removes a file or directory tree; missing paths are ignored. */
export function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Goiaba's cache directory: `$XDG_CACHE_HOME/goiaba`, or `~/.cache/goiaba`.
 * `env` is the environment to read `XDG_CACHE_HOME` from (`environment()`).
 */
export function goiabaCacheDir(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const cache = env['XDG_CACHE_HOME'];
  return join(
    cache === undefined || cache.length === 0
      ? join(homedir(), '.cache')
      : cache,
    'goiaba',
  );
}
