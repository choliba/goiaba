/**
 * How the logs are kept (`logger.logrotate`): a session goes on in the next
 * file once its file passes `maxFileSize`, and, when a session opens,
 * old sessions are compressed or deleted. A session is every part of it:
 * `<sessão>.jsonl`, `<sessão>.2.jsonl`… (and `.gz` when compressed); it is
 * deleted whole, never half. A session still being written has
 * `<sessão>.pid` with its process: while that process lives, the session
 * is never compressed nor deleted, however long it has been idle.
 */

import { gzipSync } from 'node:zlib';

import {
  fileSize,
  join,
  listDirectory,
  modifiedAt,
  pathExists,
  readBytes,
  readText,
  removePath,
  setModifiedAt,
  writeBytes,
  writeText,
} from '../filesystem/index';
import { currentPid } from '../execute/process';
import { processAlive } from '../filesystem/proc';
import { LOG_FILE_MODE } from './constants';

/** What `logger.logrotate` resolves to: every field filled in, sizes in bytes. */
export interface LogRotation {
  readonly maxFileBytes: number;
  readonly days: number;
  readonly maxTotalBytes: number;
  readonly compress: boolean;
}

/** `<sessão>` for the first part, `<sessão>.<n>` for the next ones. */
export const partSession = (session: string, part: number): string =>
  part === 1 ? session : `${session}.${String(part)}`;

/** The file that says a session is alive: its process's pid. */
const liveFile = (dir: string, session: string): string =>
  join(dir, `${session}.pid`);

/** Marks `session` as being written by this process. */
export function markLive(dir: string, session: string): void {
  writeText(liveFile(dir, session), String(currentPid()), LOG_FILE_MODE);
}

/** The session is over: nobody writes it any more. */
export function unmarkLive(dir: string, session: string): void {
  removePath(liveFile(dir, session));
}

/**
 * Whether a process is still writing `session`. A mark left by a process
 * that is gone (it ended without closing the log) is removed. A pid the
 * system gave again to another process keeps the session alive until that
 * one ends: it errs on keeping.
 */
function isLive(dir: string, session: string): boolean {
  const file = liveFile(dir, session);
  if (!pathExists(file)) return false;
  const pid = Number(readText(file).trim());
  if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) return true;
  removePath(file);
  return false;
}

/** A log file's session and part: `x.2.jsonl.gz` → `x`, 2. */
const PART = /^(.+?)(?:\.(\d+))?\.jsonl(?:\.gz)?$/;

/** What the rotation did when a session opened. */
export interface PruneResult {
  readonly deleted: readonly string[];
  readonly compressed: readonly string[];
}

interface SessionFiles {
  readonly session: string;
  readonly files: readonly string[];
  /** The latest change of any of its parts, in milliseconds. */
  readonly modified: number;
  readonly bytes: number;
}

/** The log files in `dir`, grouped by session, oldest first. */
function sessionsIn(dir: string): SessionFiles[] {
  const groups = new Map<string, string[]>();
  for (const name of pathExists(dir) ? listDirectory(dir) : []) {
    const session = PART.exec(name)?.[1];
    if (session === undefined) continue;
    groups.set(session, [...(groups.get(session) ?? []), name]);
  }
  return [...groups]
    .map(([session, names]) => {
      const files = names.map((name) => join(dir, name));
      return {
        session,
        files,
        modified: Math.max(...files.map((file) => modifiedAt(file))),
        bytes: files.reduce((total, file) => total + fileSize(file), 0),
      };
    })
    .toSorted((a, b) => a.modified - b.modified);
}

/**
 * Compresses and deletes old sessions in `dir`, as `rotation` says. The
 * current session, and any session whose process is still alive (another
 * program writing it), are kept.
 */
export function pruneLogs(
  dir: string,
  rotation: LogRotation,
  current: string,
  now: number = Date.now(),
): PruneResult {
  const deleted: string[] = [];
  const compressed: string[] = [];
  const settled = sessionsIn(dir).filter(
    (group) => group.session !== current && !isLive(dir, group.session),
  );
  const maxAge = rotation.days * 24 * 60 * 60 * 1000;
  let total = sessionsIn(dir).reduce((sum, group) => sum + group.bytes, 0);
  const maxTotal = rotation.maxTotalBytes;

  for (const group of settled) {
    // Too old, or the folder is still too big: the oldest go first.
    if (now - group.modified > maxAge || total > maxTotal) {
      for (const file of group.files) removePath(file);
      deleted.push(group.session);
      total -= group.bytes;
      continue;
    }
    if (!rotation.compress) continue;
    for (const file of group.files.filter((name) => name.endsWith('.jsonl'))) {
      const modified = modifiedAt(file);
      writeBytes(`${file}.gz`, gzipSync(readBytes(file)), LOG_FILE_MODE);
      // The session's age, not the compression's: it is still as old, and
      // it is not a live session being written.
      setModifiedAt(`${file}.gz`, modified);
      removePath(file);
      compressed.push(file);
    }
  }
  return { deleted, compressed };
}
