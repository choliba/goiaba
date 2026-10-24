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

let active: Logger | undefined;

export function openLogger(): Logger {
  if (!isConfigLoaded()) {
    active = silentLogger;
    return active;
  }

  const { logDir, debug } = getConfig();

  try {
    mkdirSync(logDir, { recursive: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Não foi possível criar ${logDir}: ${reason}`);
  }

  const file = join(logDir, `${sessionName()}.jsonl`);
  active = {
    log(record) {
      if (record.level === 'debug' && !debug) {
        return;
      }

      const line = `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`;

      try {
        appendFileSync(file, line);
      } catch (writeError) {
        const reason =
          writeError instanceof Error ? writeError.message : String(writeError);
        throw new UsageError(`Não foi possível escrever ${file}: ${reason}`);
      }
    },
  };
  return active;
}

export function getLogger(): Logger {
  return active ?? silentLogger;
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

export function logCommand(record: {
  readonly phase: string;
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly cwd?: string;
  readonly [key: string]: unknown;
}): void {
  debug({
    type: 'command',
    ...record,
    arguments: record.arguments ?? [],
  });
}

function sessionName(): string {
  return new Date().toISOString().replaceAll(':', '-');
}
