import { createInterface } from 'node:readline/promises';

export interface OutputAdapter {
  ask(question: string, signal?: AbortSignal): Promise<string>;
  write(value: string): void;
}

export class StandardOutput implements OutputAdapter {
  public async ask(_question: string, signal?: AbortSignal): Promise<string> {
    const input = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    try {
      return await input.question('', signal === undefined ? {} : { signal });
    } finally {
      input.close();
    }
  }

  public write(value: string): void {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
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
