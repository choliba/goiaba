import { appendText, join } from '../filesystem/index';
import { UsageError } from '../errors';
import type { LogSink } from './adapt';
import { LOG_FILE_MODE } from './constants';
import type { LogRecord } from './record';

export interface JsonlSinkOptions {
  readonly dir: string;
  /** Names the files: one transcript per open log. */
  readonly session: string;
  readonly debug: boolean;
  readonly service: { readonly name: string; readonly version: string };
}

const ECS_VERSION = '8.11.0';
/** The log has the conversation: only its owner reads it. */

/**
 * The log without `logger.use` in goiaba.config.ts: ECS JSON lines in
 * `dir/<session>.jsonl`; errors are told apart by `log.level`.
 */
export function createJsonlSink({
  dir,
  session,
  debug,
  service,
}: JsonlSinkOptions): LogSink {
  const file = join(dir, `${session}.jsonl`);

  return {
    write(record) {
      if (record.level === 'debug' && !debug) return;

      const line = `${JSON.stringify(ecsLine(record, service))}\n`;
      append(file, line);
    },
    close() {},
  };
}

function ecsLine(
  { timestamp, level, message, fields }: LogRecord,
  service: JsonlSinkOptions['service'],
): Record<string, unknown> {
  return {
    '@timestamp': timestamp,
    'log.level': level,
    'ecs.version': ECS_VERSION,
    service,
    message,
    ...fields,
  };
}

function append(file: string, line: string): void {
  try {
    appendText(file, line, LOG_FILE_MODE);
  } catch (writeError) {
    const reason =
      writeError instanceof Error ? writeError.message : String(writeError);
    throw new UsageError(`Não foi possível escrever ${file}: ${reason}`);
  }
}
