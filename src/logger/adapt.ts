import { UsageError } from '../errors';
import type { LogLevel, LogRecord } from './record';

/** Where records go; the only thing the logger knows about the package. */
export interface LogSink {
  write(record: LogRecord): void;
  close(): void;
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/**
 * What `logger.use` created, recognized by its shape so Goiaba does not
 * import any log package. The instance owns its format, level and
 * destination (`@timestamp`, `log.level` and `service` included).
 */
export function adaptLogger(instance: object): LogSink {
  const call = (name: string, args: readonly unknown[]): void => {
    const method: unknown = Reflect.get(instance, name);
    if (typeof method === 'function') Reflect.apply(method, instance, args);
  };

  // pino: (mergingObject, message).
  if (hasMethods(instance, ['child', 'bindings']) && 'levels' in instance) {
    return {
      write: ({ level, message, fields }) => call(level, [fields, message]),
      close: () => call('flush', []),
    };
  }

  // winston: one info object with level and message.
  if (hasMethods(instance, ['log']) && 'transports' in instance) {
    return {
      write: ({ level, message, fields }) =>
        call('log', [{ ...fields, level, message }]),
      close: () => call('end', []),
    };
  }

  // LogTape, console and anything with the four levels: (message, properties).
  if (hasMethods(instance, LEVELS)) {
    return {
      write: ({ level, message, fields }) => call(level, [message, fields]),
      close: () => undefined,
    };
  }

  throw new UsageError(
    `logger.use em goiaba.config.ts criou um logger não reconhecido: esperado pino, winston, LogTape ou um objeto com ${LEVELS.join('/')}.`,
  );
}

function hasMethods(instance: object, names: readonly string[]): boolean {
  return names.every(
    (name) => typeof Reflect.get(instance, name) === 'function',
  );
}
