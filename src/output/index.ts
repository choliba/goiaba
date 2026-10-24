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
  const values: T[] = [];
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
        values.push(value);
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
        while (values.length > 0 || !ended) {
          if (values.length === 0) {
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
            continue;
          }

          yield values.shift() as T;
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
