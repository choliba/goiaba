import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

import {
  ensureDirectory,
  fileSize,
  join,
  pathExists,
  readText,
} from '../filesystem/index';
import { getConfig, isConfigLoaded } from '../config/index';
import { UsageError } from '../errors';
import { currentContext } from '../context/index';
import { adaptLogger, type LogSink } from './adapt';
import { MAX_ERROR_LENGTH } from './constants';
import { createJsonlSink } from './jsonl';
import { markLive, partSession, pruneLogs, unmarkLive } from './rotate';
import { maskRecord } from './mask';
import { toLogRecord, type LogContext, type LogEntry } from './record';

export * from './constants';

export type { LogSink } from './adapt';
export type { LogEntry, LogLevel, LogRecord } from './record';

/** What a producer logs: `type` and its fields; `ts` and the scope are added. */
export interface LogInput {
  readonly type: string;
  readonly level?: never;
  readonly [key: string]: unknown;
}

export interface Log {
  info(record: LogInput): void;
  /** Recorded only with `debug: true`. */
  debug(record: LogInput): void;
  /** Always recorded, with `log.level: error`. */
  error(record: LogInput): void;
  /** A thrown error, once however many layers see it on its way up. */
  failure(error: unknown): void;
}

const SERVICE_NAME = 'goiaba';

/** Where records go while the log is open; without it they are dropped. */
let write: ((entry: LogEntry) => void) | undefined;
let open = false;
let sink: LogSink | undefined;
/** The session this process marked as alive, to unmark on close. */
let live: { readonly dir: string; readonly session: string } | undefined;

const reportedFailures = new WeakSet<object>();

function record(level: LogEntry['level'], input: LogInput): void {
  write?.({
    ts: new Date().toISOString(),
    ...currentContext(),
    ...input,
    ...(level === undefined ? {} : { level }),
  });
}

/** The log: only knows how to record, not who records (no `log.command`). */
export const log: Log = {
  info: (input) => record(undefined, input),
  debug: (input) => record('debug', input),
  error: (input) => record('error', input),
  failure: (error) => {
    if (typeof error === 'object' && error !== null) {
      if (reportedFailures.has(error)) return;
      reportedFailures.add(error);
    }

    record('error', {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  },
};

/**
 * Opens the log: every record, in the ECS/OTel contract and with secrets
 * masked, goes to the instance `logger.use` creates or, without it, to ECS
 * JSONL in `logger.dir`.
 */
export function openLogger(): void {
  closeLogger();
  open = true;

  if (!isConfigLoaded()) return;

  const config = getConfig();
  const session = new Date().toISOString().replaceAll(':', '-');
  const { dir, use, logrotate } = config.logger;
  const context: LogContext = { traceId: randomUUID(), userName: userName() };
  const env: Record<string, string> = {};
  for (const { vars } of config.envs) Object.assign(env, vars);
  const maxFileBytes = logrotate?.maxFileBytes;

  /** The sink of one part of the session: `<sessão>.jsonl`, `<sessão>.2.jsonl`… */
  const sinkOf = (part: number): LogSink => {
    const name = partSession(session, part);
    return use === undefined
      ? defaultSink(dir, name)
      : adaptLogger(use({ dir, session: name }));
  };
  let part = 1;
  /** Bytes sent to this part, as far as the logger can tell. */
  let sent = 0;

  // The destination is made on the first record, not here: a program that
  // logs nothing (e.g. `bun clear`) leaves no empty log behind.
  write = (entry) => {
    const opening = sink === undefined;
    if (sink === undefined) {
      ensureLogDir(dir);
      sink = sinkOf(part);
      if (logrotate !== undefined) {
        markLive(dir, session);
        live = { dir, session };
      }
    }
    const line = maskRecord(toLogRecord(entry, context), env);
    sink.write(line);
    if (opening && logrotate !== undefined) rotateOld(dir, logrotate, session);
    if (maxFileBytes === undefined) return;
    // A soft limit: the record just written stays whole; the next one goes
    // on in the next part. The file on disk says how big it really is (the
    // package adds its own fields); without one where it is expected (a
    // `use` writing elsewhere), the count of what was sent.
    sent += JSON.stringify(line).length;
    const file = join(dir, `${partSession(session, part)}.jsonl`);
    const size = pathExists(file) ? fileSize(file) : sent;
    if (size < maxFileBytes) return;
    sink.close();
    part += 1;
    sent = 0;
    sink = sinkOf(part);
  };
}

/**
 * Compresses and deletes old sessions, once, when a session opens; what it
 * did goes to the log. A failure to rotate is logged, never fatal: the
 * program goes on with its own log.
 */
function rotateOld(
  dir: string,
  rotation: Parameters<typeof pruneLogs>[1],
  session: string,
): void {
  try {
    const { deleted, compressed } = pruneLogs(dir, rotation, session);
    if (deleted.length > 0 || compressed.length > 0) {
      log.info({ type: 'logrotate', deleted, compressed });
    }
  } catch (error) {
    log.error({
      type: 'error',
      message: `A rotação dos logs falhou: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function isLoggerOpen(): boolean {
  return open;
}

export function closeLogger(): void {
  write = undefined;
  sink?.close();
  sink = undefined;
  if (live !== undefined) unmarkLive(live.dir, live.session);
  live = undefined;
  open = false;
}

export function isDebug(): boolean {
  return isConfigLoaded() && getConfig().debug;
}

/** Error output can be huge (stack traces, npm logs); keep the head. */
export function truncateError(
  text: string,
  maxLength = MAX_ERROR_LENGTH,
): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}… (${String(text.length)} caracteres)`;
}

function ensureLogDir(dir: string): void {
  try {
    ensureDirectory(dir, 0o700);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Não foi possível criar ${dir}: ${reason}`);
  }
}

function defaultSink(dir: string, session: string): LogSink {
  return createJsonlSink({
    dir,
    session,
    debug: getConfig().debug,
    service: { name: SERVICE_NAME, version: serviceVersion() },
  });
}

function serviceVersion(): string {
  try {
    const manifest: unknown = JSON.parse(
      readText(new URL('../../package.json', import.meta.url).pathname),
    );
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? manifest.version
        : undefined;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function userName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'desconhecido';
  }
}
