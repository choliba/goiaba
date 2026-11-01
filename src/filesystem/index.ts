import {
  appendFileSync,
  closeSync,
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
import { join } from 'node:path';

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

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
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
