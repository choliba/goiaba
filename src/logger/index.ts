import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

import { ensureDirectory, readText } from '../filesystem/index';
import { getConfig, isConfigLoaded } from '../config/index';
import { UsageError } from '../errors';
import { onActivity, type Activity } from '../output/activity';
import { adaptLogger, type LogSink } from './adapt';
import { createJsonlSink } from './jsonl';
import { maskRecord } from './mask';
import { toLogRecord, type LogContext } from './record';

export type { LogSink } from './adapt';
export type { LogLevel, LogRecord } from './record';

export interface Logger {
  log(record: Record<string, unknown> & { readonly type: string }): void;
}

const silentLogger: Logger = {
  log() {},
};

const SERVICE_NAME = 'goiaba';

let active: Logger | undefined;
let sink: LogSink | undefined;
let stopListening: (() => void) | undefined;

/**
 * Opens the log: every activity, in the ECS/OTel contract and with secrets
 * masked, goes to the instance `logger.use` creates or, without it, to ECS
 * JSONL in `logger.dir`.
 */
export function openLogger(): Logger {
  closeLogger();

  if (!isConfigLoaded()) {
    active = silentLogger;
    return active;
  }

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

  const write = (activity: Activity): void => {
    output.write(maskRecord(toLogRecord(activity, context), env));
  };

  sink = output;
  active = {
    log: (record) => write({ ts: new Date().toISOString(), ...record }),
  };
  // The log is one listener of the activity: it only hands it to the sink.
  stopListening = onActivity(write);
  return active;
}

export function getLogger(): Logger {
  return active ?? silentLogger;
}

export function isLoggerOpen(): boolean {
  return active !== undefined;
}

export function closeLogger(): void {
  stopListening?.();
  stopListening = undefined;
  sink?.close();
  sink = undefined;
  active = undefined;
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
