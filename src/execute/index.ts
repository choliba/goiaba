import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioPipe,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import { truncateError } from '../logger/index';
import { reportCommand } from '../output/activity';
import { OutputDispatcher, OutputStream } from '../output/index';
import type { ProgramCommand, ProgramOutput } from './types';
import type { Provider, ProviderEvent } from '../providers/types';
import type { Workspace } from '../workspace/index';

/** Starts a process with piped stdio; injectable for tests. */
export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
) => ChildProcessByStdio<Writable, Readable, Readable>;

export interface ExecutorOptions<TOutput> {
  readonly output?: OutputDispatcher<ProviderEvent<TOutput>>;
  readonly createExecutionId?: () => string;
  readonly spawnProcess?: SpawnProcess;
}

export class Executor<TOutput = string> {
  private readonly output: OutputDispatcher<ProviderEvent<TOutput>>;
  private readonly createExecutionId: () => string;
  private readonly spawnProcess: SpawnProcess;

  public constructor({
    output = new OutputDispatcher<ProviderEvent<TOutput>>(),
    createExecutionId = randomUUID,
    spawnProcess = (executable, args, options) =>
      spawn(executable, args, options),
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
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent<TOutput>> {
    const executionId = this.createExecutionId();
    const result = this.output.open(executionId, provider.id);

    void this.execute(
      executionId,
      provider,
      workspace,
      input,
      sessionId,
      signal,
    );
    return result;
  }

  private async execute<TInput>(
    executionId: string,
    provider: Provider<TInput, TOutput>,
    workspace: Workspace,
    input: TInput,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let stopOnAbort: (() => void) | undefined;

    try {
      signal?.throwIfAborted();
      const inner = provider.createCommand(input, sessionId, workspace.root);
      reportCommand({
        phase: 'inner',
        executionId,
        provider: provider.id,
        executable: inner.executable,
        arguments: inner.arguments ?? [],
        cwd: inner.cwd ?? workspace.root,
      });

      const command = await workspace.prepare(inner);
      reportCommand({
        phase: 'spawn',
        executionId,
        provider: provider.id,
        executable: command.executable,
        arguments: command.arguments ?? [],
        cwd: command.cwd,
      });

      signal?.throwIfAborted();
      const startedAt = performance.now();
      const { process, output, completion } = this.start(command);
      stopOnAbort = () => {
        terminate(process);
        // The CLI may run as a grandchild (nsenter -p forks); only tearing
        // down the sandbox reaches it.
        void workspace.close();
      };
      signal?.addEventListener('abort', stopOnAbort, { once: true });

      if (process.stdin === null) {
        throw new Error('O processo não expôs entrada.');
      }

      try {
        await workspace.sandbox.started?.(process.pid);
      } catch {
        // Falha de inspect/debug não deve abortar a execução.
      }

      process.stdin.end(command.input);

      for await (const value of provider.parseOutput(output)) {
        this.output.publish(executionId, provider.id, value);
      }

      const status = await completion;
      // A killed CLI exits with a signal; report the abort, not the exit.
      signal?.throwIfAborted();
      reportCommand({
        phase: 'exit',
        executionId,
        provider: provider.id,
        executable: command.executable,
        // Which command ended, without looking up its spawn record.
        commandLine: truncateError(
          [command.executable, ...(command.arguments ?? [])].join(' '),
        ),
        cwd: command.cwd,
        pid: process.pid,
        // Nanoseconds, as ECS `event.duration`.
        duration: Math.round((performance.now() - startedAt) * 1e6),
        code: status.code,
        signal: status.signal,
      });

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
      this.output.fail(
        executionId,
        provider.id,
        toError(signal?.aborted === true ? signal.reason : error),
      );
    } finally {
      if (stopOnAbort !== undefined) {
        signal?.removeEventListener('abort', stopOnAbort);
      }
    }
  }

  private start(command: ProgramCommand): StartedProcess {
    const process = this.spawnProcess(
      command.executable,
      [...(command.arguments ?? [])],
      {
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

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
    const reason =
      signal === null ? `código ${String(code)}` : `sinal ${signal}`;
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

  const output = new OutputStream<ProgramOutput>();
  let openStreams = 2;
  let ended = false;

  const finish = (): void => {
    openStreams -= 1;

    if (openStreams === 0 && !ended) {
      ended = true;
      output.close();
    }
  };

  stdout.on('data', (chunk: string) => {
    if (!ended) {
      output.publish({ channel: 'stdout', chunk });
    }
  });
  stderr.on('data', (chunk: string) => {
    if (!ended) {
      output.publish({ channel: 'stderr', chunk });
    }
  });
  stdout.once('end', finish);
  stderr.once('end', finish);
  process.once('error', (error) => {
    if (!ended) {
      ended = true;
      output.fail(error);
    }
  });

  yield* output;
}

function waitForCompletion(process: ChildProcess): Promise<ProcessStatus> {
  return new Promise((resolve) => {
    process.once('error', (error) => {
      resolve({ code: null, signal: null, error });
    });
    process.once('close', (code, signal) => resolve({ code, signal }));
  });
}

const KILL_GRACE_MS = 2000;

function terminate(process: ChildProcess): void {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  process.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
    }
  }, KILL_GRACE_MS);
  timer.unref();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
