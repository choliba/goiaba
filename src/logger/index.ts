import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

import { ensureDirectory, readText } from '../filesystem/index';
import { getConfig, isConfigLoaded } from '../config/index';
import { UsageError } from '../errors';
import { currentScope } from '../scope/index';
import { adaptLogger, type LogSink } from './adapt';
import { createJsonlSink } from './jsonl';
import { maskRecord } from './mask';
import { toLogRecord, type LogContext, type LogEntry } from './record';

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

const reportedFailures = new WeakSet<object>();

function record(level: LogEntry['level'], input: LogInput): void {
  write?.({
    ts: new Date().toISOString(),
    ...currentScope(),
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
  const { dir, use } = config.logger;
  ensureLogDir(dir);
  const output =
    use === undefined
      ? defaultSink(dir, session)
      : adaptLogger(use({ dir, session }));
  const context: LogContext = { traceId: randomUUID(), userName: userName() };
  const env: Record<string, string> = {};
  for (const { vars } of config.envs) Object.assign(env, vars);

  sink = output;
  write = (entry) => {
    output.write(maskRecord(toLogRecord(entry, context), env));
  };
}

export function isLoggerOpen(): boolean {
  return open;
}

export function closeLogger(): void {
  write = undefined;
  sink?.close();
  sink = undefined;
  open = false;
}

export function isDebug(): boolean {
  return isConfigLoaded() && getConfig().debug;
}

const MAX_ERROR_LENGTH = 4000;

/** Error output can be huge (stack traces, npm logs); keep the head. */
export function truncateError(text: string): string {
  return text.length <= MAX_ERROR_LENGTH
    ? text
    : `${text.slice(0, MAX_ERROR_LENGTH)}… (${String(text.length)} caracteres)`;
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
