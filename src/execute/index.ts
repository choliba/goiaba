import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioPipe,
} from 'node:child_process';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

import { log, truncateError } from '../logger/index';
import { KILL_GRACE_MS } from './constants';
import { OutputStream } from './stream';
import type { ProgramCommand, ProgramOutput } from './types';

export * from './constants';
export { OutputDispatcher, OutputStream, type OutputEvent } from './stream';

/** Starts a process with piped stdio; injectable for tests. */
export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
) => ChildProcessByStdio<Writable, Readable, Readable>;

export interface ExecutorOptions {
  readonly createExecutionId?: () => string;
  readonly spawnProcess?: SpawnProcess;
  /** Milliseconds between SIGTERM and SIGKILL; `KILL_GRACE_MS` by default. */
  readonly killGraceMs?: number;
}

export interface RunOptions {
  /** Aborting kills the program (SIGTERM, then SIGKILL) and ends the run with its reason. */
  readonly signal?: AbortSignal;
  /** The program started: e.g. a sandbox inspecting it. A failure here is ignored. */
  readonly onStart?: (pid: number | undefined) => void | Promise<void>;
  /** Besides killing the program on abort: e.g. tearing down a sandbox it runs in. */
  readonly onAbort?: () => void;
  /** Fields added to this run's log records (who asked for it, an id of yours…). */
  readonly logFields?: Readonly<Record<string, unknown>>;
}

/**
 * Runs one program and hands over what it prints, as it prints it: stdout
 * and stderr chunks, in the order they arrive. Knows nothing of who asked
 * or what the output means: prepare the command (a sandbox) before, read
 * the output after. A program that fails ends the sequence with an error.
 */
export class Executor {
  private readonly createExecutionId: () => string;
  private readonly spawnProcess: SpawnProcess;
  private readonly killGraceMs: number;

  public constructor({
    createExecutionId = randomUUID,
    spawnProcess = (executable, args, options) =>
      spawn(executable, args, options),
    killGraceMs = KILL_GRACE_MS,
  }: ExecutorOptions = {}) {
    this.createExecutionId = createExecutionId;
    this.spawnProcess = spawnProcess;
    this.killGraceMs = killGraceMs;
  }

  public async *run(
    command: ProgramCommand,
    { signal, onStart, onAbort, logFields = {} }: RunOptions = {},
  ): AsyncGenerator<ProgramOutput> {
    signal?.throwIfAborted();
    const fields = { executionId: this.createExecutionId(), ...logFields };
    reportCommand({
      phase: 'spawn',
      ...fields,
      executable: command.executable,
      arguments: command.arguments ?? [],
      cwd: command.cwd,
    });

    const startedAt = performance.now();
    const { process, output, completion } = this.start(command);
    const stop = (): void => {
      terminate(process, this.killGraceMs);
      // A program that forks (nsenter -p) may leave its child behind:
      // only the caller knows how to reach it.
      onAbort?.();
    };
    signal?.addEventListener('abort', stop, { once: true });

    try {
      if (process.stdin === null) {
        throw new Error('O processo não expôs entrada.');
      }
      try {
        await onStart?.(process.pid);
      } catch {
        // Inspection or debug failing must not stop the program.
      }
      writeInput(process.stdin, command.inputStream ?? command.input);

      yield* output;

      const status = await completion;
      // A killed program exits with a signal: report the abort, not the exit.
      signal?.throwIfAborted();
      reportCommand({
        phase: 'exit',
        ...fields,
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

      if (status.error !== undefined) throw status.error;
      if (status.code !== 0 || status.signal !== null) {
        throw new ProgramExecutionError(
          command.executable,
          status.code,
          status.signal,
        );
      }
    } catch (error) {
      throw toError(signal?.aborted === true ? signal.reason : error);
    } finally {
      signal?.removeEventListener('abort', stop);
      // Left before the end (a `break`): the program is not wanted anymore.
      terminate(process, this.killGraceMs);
    }
  }

  private start(command: ProgramCommand): StartedProcess {
    const process = this.spawnProcess(
      command.executable,
      [...(command.arguments ?? [])],
      {
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        ...(command.env === undefined ? {} : { env: { ...command.env } }),
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

/**
 * The program's output as one sequence. Listens right away, at start: an
 * error starting the program comes before anyone reads, and would be lost.
 */
function readProcessOutput(
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

  return output;
}

function waitForCompletion(process: ChildProcess): Promise<ProcessStatus> {
  return new Promise((resolve) => {
    process.once('error', (error) => {
      resolve({ code: null, signal: null, error });
    });
    process.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function terminate(process: ChildProcess, graceMs: number): void {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  process.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (process.exitCode === null && process.signalCode === null) {
      process.kill('SIGKILL');
    }
  }, graceMs);
  timer.unref();
}

/** What was run, sent to the log (in debug). */
function reportCommand(record: {
  readonly phase: string;
  readonly executable: string;
  readonly arguments?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly [key: string]: unknown;
}): void {
  // Without `arguments` the record has none: `[]` would say "no arguments".
  log.debug({ type: 'command', ...record });
}

/**
 * A text is written whole and stdin closed; a stream is piped as it comes
 * and stdin closed when it ends. A program that exits before reading it all
 * (a broken pipe) is not an error here: its exit says what happened.
 */
function writeInput(
  stdin: Writable,
  input: string | AsyncIterable<string> | undefined,
): void {
  if (input === undefined || typeof input === 'string') {
    stdin.end(input);
    return;
  }
  stdin.on('error', () => undefined);
  void pipeline(Readable.from(input), stdin).catch(() => undefined);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
