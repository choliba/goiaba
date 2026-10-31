import { readAllInput, TerminalInput } from '../input/index';
import { terminalColumns, writeErr, writeOut, writeStatus } from './terminal';

export interface OutputAdapter {
  /** A line; where it can, a key of `instant` answers alone (no Enter). */
  ask(
    question: string,
    signal?: AbortSignal,
    instant?: readonly string[],
  ): Promise<string>;
  /** A complete unsolicited line typed while the agent is working. */
  listen?(signal?: AbortSignal): Promise<string>;
  /**
   * One of `keys`, answered with a single keypress where possible; `''` for
   * Enter (the default). Adapters without it are asked a line instead.
   */
  choose?(keys: readonly string[], signal?: AbortSignal): Promise<string>;
  close?(): void;
  write(value: string): void;
  /**
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it. Adapters without it get the first status as a line.
   */
  status?(text: string | undefined): void;
  /** Characters per line, for tables; adapters without it get 120. */
  width?(): number;
}

const DEFAULT_WIDTH = 120;

export class StandardOutput implements OutputAdapter {
  private readonly input = new TerminalInput();

  public ask(
    _question: string,
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    return this.input.next(signal, instant);
  }

  public listen(signal?: AbortSignal): Promise<string> {
    return this.input.next(signal);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const key = await this.input.choose(keys, signal);
    this.write(key === '' ? '' : key);
    return key;
  }

  public write(value: string): void {
    writeOut(value.endsWith('\n') ? value : `${value}\n`);
  }

  public status(text: string | undefined): void {
    writeStatus(text);
  }

  /** Width of the terminal, in characters; 120 when not a terminal. */
  public width(): number {
    return terminalColumns() ?? DEFAULT_WIDTH;
  }

  /** Diagnostics for whoever runs the program, apart from its output. */
  public writeError(value: string): void {
    writeErr(value.endsWith('\n') ? value : `${value}\n`);
  }

  /** Everything piped to stdin, for programs fed one request (e.g. a hook). */
  public readInput(): string {
    return readAllInput();
  }

  public close(): void {
    this.input.close();
  }
}

export interface OutputEvent<T> {
  readonly executionId: string;
  readonly programId: string;
  readonly value: T;
}

interface OutputQueue<T> {
  push(value: T): void;
  close(): void;
  fail(error: Error): void;
  read(onReturn?: () => void): AsyncIterable<T>;
}

export class OutputStream<T> implements AsyncIterable<T> {
  private readonly queue = createQueue<T>();

  public publish(value: T): void {
    this.queue.push(value);
  }

  public close(): void {
    this.queue.close();
  }

  public fail(error: Error): void {
    this.queue.fail(error);
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.queue.read()[Symbol.asyncIterator]();
  }
}

interface Execution<T> {
  readonly programId: string;
  readonly queue: OutputQueue<T>;
}

export class OutputDispatcher<T> {
  private readonly executions = new Map<string, Execution<T>>();
  private readonly subscribers = new Set<OutputQueue<OutputEvent<T>>>();

  public open(executionId: string, programId: string): AsyncIterable<T> {
    if (this.executions.has(executionId)) {
      throw new Error(`A execução ${executionId} já existe.`);
    }

    const queue = createQueue<T>();
    this.executions.set(executionId, { programId, queue });
    return queue.read();
  }

  public publish(executionId: string, programId: string, value: T): void {
    const execution = this.getExecution(executionId, programId);
    const event = { executionId, programId, value };

    execution.queue.push(value);

    for (const subscriber of this.subscribers) {
      subscriber.push(event);
    }
  }

  public close(executionId: string, programId: string): void {
    const execution = this.getExecution(executionId, programId);
    this.executions.delete(executionId);
    execution.queue.close();
  }

  public fail(executionId: string, programId: string, error: Error): void {
    const execution = this.getExecution(executionId, programId);
    this.executions.delete(executionId);
    execution.queue.fail(error);
  }

  public subscribe(): AsyncIterable<OutputEvent<T>> {
    const queue = createQueue<OutputEvent<T>>();
    this.subscribers.add(queue);
    return queue.read(() => this.subscribers.delete(queue));
  }

  private getExecution(executionId: string, programId: string): Execution<T> {
    const execution = this.executions.get(executionId);

    if (execution === undefined) {
      throw new Error(`A execução ${executionId} não está aberta.`);
    }

    if (execution.programId !== programId) {
      throw new Error(`A execução ${executionId} não pertence a ${programId}.`);
    }

    return execution;
  }
}

function createQueue<T>(): OutputQueue<T> {
  // Boxed so a queued `undefined` is not mistaken for an empty queue.
  const values: { readonly value: T }[] = [];
  let ended = false;
  let failure: Error | undefined;
  let waiting: (() => void) | undefined;

  const wake = (): void => {
    const resolve = waiting;
    waiting = undefined;
    resolve?.();
  };

  return {
    push(value): void {
      if (!ended) {
        values.push({ value });
        wake();
      }
    },
    close(): void {
      if (!ended) {
        ended = true;
        wake();
      }
    },
    fail(error): void {
      if (!ended) {
        ended = true;
        failure = error;
        wake();
      }
    },
    async *read(onReturn): AsyncGenerator<T> {
      try {
        for (;;) {
          const next = values.shift();

          if (next !== undefined) {
            yield next.value;
          } else if (ended) {
            break;
          } else {
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
          }
        }

        if (failure !== undefined) {
          throw failure;
        }
      } finally {
        onReturn?.();
      }
    },
  };
}
