import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { getConfig, isConfigLoaded } from '../config/index.js';
import { UsageError } from '../errors.js';

export interface Logger {
  log(record: Record<string, unknown>): void;
}

const silentLogger: Logger = {
  log() {},
};

const ERROR_DIR = 'erros';

let active: Logger | undefined;

export function openLogger(): Logger {
  if (!isConfigLoaded()) {
    active = silentLogger;
    return active;
  }

  const { logDir, debug: debugEnabled } = getConfig();

  try {
    mkdirSync(logDir, { recursive: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Não foi possível criar ${logDir}: ${reason}`);
  }

  const session = sessionName();
  const file = join(logDir, `${session}.jsonl`);
  const errorDir = join(logDir, ERROR_DIR);
  const errorFile = join(errorDir, `${session}.jsonl`);
  active = {
    log(record) {
      if (record['level'] === 'debug' && !debugEnabled) {
        return;
      }

      const line = `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`;
      append(file, line);

      // Errors are also kept apart, so they are not lost in the transcript.
      if (record['level'] === 'error') {
        mkdirSync(errorDir, { recursive: true });
        append(errorFile, line);
      }
    },
  };
  return active;
}

export function getLogger(): Logger {
  return active ?? silentLogger;
}

export function isLoggerOpen(): boolean {
  return active !== undefined;
}

export function closeLogger(): void {
  active = undefined;
}

export function isDebug(): boolean {
  return isConfigLoaded() && getConfig().debug;
}

export function debug(record: Record<string, unknown>): void {
  getLogger().log({ level: 'debug', ...record });
}

/** Logged even without `debug`, in the transcript and in `logDir/erros`. */
export function logError(record: Record<string, unknown>): void {
  getLogger().log({ level: 'error', ...record });
}

const loggedFailures = new WeakSet<object>();

/** Logs a thrown error once, however many layers report it on its way up. */
export function logFailure(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    if (loggedFailures.has(error)) return;
    loggedFailures.add(error);
  }

  logError({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

const MAX_ERROR_LENGTH = 4000;

/** Error output can be huge (stack traces, npm logs); keep the head. */
export function truncateError(text: string): string {
  return text.length <= MAX_ERROR_LENGTH
    ? text
    : `${text.slice(0, MAX_ERROR_LENGTH)}… (${String(text.length)} caracteres)`;
}

export function logCommand(record: {
  readonly phase: string;
  readonly executable: string;
  readonly arguments?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly [key: string]: unknown;
}): void {
  debug({
    type: 'command',
    ...record,
    arguments: record.arguments ?? [],
  });
}

function append(file: string, line: string): void {
  try {
    appendFileSync(file, line);
  } catch (writeError) {
    const reason =
      writeError instanceof Error ? writeError.message : String(writeError);
    throw new UsageError(`Não foi possível escrever ${file}: ${reason}`);
  }
}

function sessionName(): string {
  return new Date().toISOString().replaceAll(':', '-');
}
