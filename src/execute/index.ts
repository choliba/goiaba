import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { OutputDispatcher } from '../output/index.js';
import type {
  ProgramCommand,
  ProgramOutput,
} from './types.js';
import type { Provider, ProviderEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';

export interface ExecutorOptions<TOutput> {
  readonly output?: OutputDispatcher<ProviderEvent<TOutput>>;
  readonly createExecutionId?: () => string;
  readonly spawnProcess?: typeof spawn;
}

export class Executor<TOutput = string> {
  private readonly output: OutputDispatcher<ProviderEvent<TOutput>>;
  private readonly createExecutionId: () => string;
  private readonly spawnProcess: typeof spawn;

  public constructor({
    output = new OutputDispatcher<ProviderEvent<TOutput>>(),
    createExecutionId = randomUUID,
    spawnProcess = spawn,
  }: ExecutorOptions<TOutput> = {}) {
    this.output = output;
    this.createExecutionId = createExecutionId;
    this.spawnProcess = spawnProcess;
  }

  public run<TInput>(
    provider: Provider<TInput, TOutput>,
    workspace: Workspace,
    input: TInput,
    sessionId?: string,
  ): AsyncIterable<ProviderEvent<TOutput>> {
    const executionId = this.createExecutionId();
    const result = this.output.open(executionId, provider.id);

    void this.execute(executionId, provider, workspace, input, sessionId);
    return result;
  }

  private async execute<TInput>(
    executionId: string,
    provider: Provider<TInput, TOutput>,
    workspace: Workspace,
    input: TInput,
    sessionId?: string,
  ): Promise<void> {
    try {
      const command = await workspace.prepare(
        provider.createCommand(input, sessionId),
      );
      const { process, output, completion } = this.start(command);

      if (process.stdin === null) {
        throw new Error('O processo não expôs entrada.');
      }

      process.stdin.end(command.input);

      for await (const value of provider.parseOutput(output)) {
        this.output.publish(executionId, provider.id, value);
      }

      const status = await completion;

      if (status.error !== undefined) {
        throw status.error;
      }

      if (status.code !== 0 || status.signal !== null) {
        throw new ProgramExecutionError(
          command.executable,
          status.code,
          status.signal,
        );
      }

      this.output.close(executionId, provider.id);
    } catch (error) {
      this.output.fail(executionId, provider.id, toError(error));
    }
  }

  private start(command: ProgramCommand): StartedProcess {
    const process = this.spawnProcess(
      command.executable,
      [...(command.arguments ?? [])],
      {
        cwd: command.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    if (process.stdout === null || process.stderr === null) {
      throw new Error('O processo não expôs os canais de saída esperados.');
    }

    return {
      process,
      output: readProcessOutput(process),
      completion: waitForCompletion(process),
    };
  }
}

export class ProgramExecutionError extends Error {
  public constructor(
    public readonly executable: string,
    public readonly code: number | null,
    public readonly signal: NodeJS.Signals | null,
  ) {
    const reason = signal === null ? `código ${String(code)}` : `sinal ${signal}`;
    super(`O programa ${executable} terminou com ${reason}.`);
    this.name = 'ProgramExecutionError';
  }
}

interface StartedProcess {
  readonly process: ChildProcess;
  readonly output: AsyncIterable<ProgramOutput>;
  readonly completion: Promise<ProcessStatus>;
}

interface ProcessStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

async function* readProcessOutput(
  process: ChildProcess,
): AsyncIterable<ProgramOutput> {
  const stdout = process.stdout;
  const stderr = process.stderr;

  if (stdout === null || stderr === null) {
    throw new Error('O processo não expôs os canais de saída esperados.');
  }

  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const queue = new OutputDispatcher<ProgramOutput>();
  const id = 'process-output';
  const iterable = queue.open(id, id);
  let openStreams = 2;
  let ended = false;

  const finish = (): void => {
    openStreams -= 1;

    if (openStreams === 0 && !ended) {
      ended = true;
      queue.close(id, id);
    }
  };

  stdout.on('data', (chunk: string) => {
    if (!ended) {
      queue.publish(id, id, { channel: 'stdout', chunk });
    }
  });
  stderr.on('data', (chunk: string) => {
    if (!ended) {
      queue.publish(id, id, { channel: 'stderr', chunk });
    }
  });
  stdout.once('end', finish);
  stderr.once('end', finish);
  process.once('error', (error) => {
    if (!ended) {
      ended = true;
      queue.fail(id, id, error);
    }
  });

  yield* iterable;
}

function waitForCompletion(process: ChildProcess): Promise<ProcessStatus> {
  return new Promise((resolve) => {
    process.once('error', (error) => {
      resolve({ code: null, signal: null, error });
    });
    process.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
