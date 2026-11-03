import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants, homedir } from 'node:os';
import { promisify } from 'node:util';

import { HELPER_MAX_OUTPUT_BYTES } from './constants';

/**
 * The current process and the programs Goiaba starts besides the agent's CLI
 * (which goes through `Executor`). Nothing else touches `process` directly.
 */

const execFileAsync = promisify(execFile);

/** Arguments given to the current program, without the runtime and script. */
export function programArguments(): readonly string[] {
  return process.argv.slice(2);
}

export interface CurrentProcessCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

/** Command needed to start this script again from the same directory. */
export function currentProcessCommand(): CurrentProcessCommand {
  return {
    executable: process.execPath,
    arguments: process.argv.slice(1),
    cwd: currentDirectory(),
  };
}

/** Ends the current program with `code`. */
export function exitProgram(code: number): never {
  process.exit(code);
}

/**
 * What the program does with an error nobody caught, thrown or awaited at
 * the top of a script, instead of the runtime's default.
 */
export function onUncaughtError(handle: (error: unknown) => void): void {
  process.on('uncaughtException', handle);
}

const exitListeners = new Set<() => void>();
/** Termination signals that end the program without an `exit` event. */
const TERMINATION_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGHUP'];

/**
 * Runs `listener` once when the program ends, however it ends: the work is
 * over, `exitProgram`, an uncaught error, a termination signal. For undoing
 * what was done to the world outside (a terminal left in raw mode), so it
 * must be synchronous. Returns how to stop: call it once the thing is undone
 * by its owner.
 */
export function onProgramExit(listener: () => void): () => void {
  if (exitListeners.size === 0) {
    process.on('exit', runExitListeners);
    for (const signal of TERMINATION_SIGNALS) process.on(signal, endBySignal);
  }
  exitListeners.add(listener);

  return () => {
    exitListeners.delete(listener);
    if (exitListeners.size > 0) return;
    process.off('exit', runExitListeners);
    for (const signal of TERMINATION_SIGNALS) process.off(signal, endBySignal);
  };
}

function runExitListeners(): void {
  const listeners = [...exitListeners];
  exitListeners.clear();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One failing cleanup must not keep the others from running.
    }
  }
}

/** Cleans up, then lets the signal end the program as it would have. */
function endBySignal(signal: NodeJS.Signals): void {
  runExitListeners();
  process.off('exit', runExitListeners);
  for (const each of TERMINATION_SIGNALS) process.off(each, endBySignal);
  // Someone else (runAttached) decides what this signal does.
  if (process.listenerCount(signal) > 0) return;
  process.kill(process.pid, signal);
}

/** The code the program ends with, without ending it now. */
export function setExitCode(code: number): void {
  process.exitCode = code;
}

/**
 * The user's home: `HOME` as it is now (the runtime's `homedir()` keeps the
 * value it read first), or the system's when unset.
 */
export function userHome(): string {
  return process.env['HOME'] ?? homedir();
}

/** Working directory of the current program. */
export function currentDirectory(): string {
  return process.cwd();
}

/** Id of the current process. */
export function currentPid(): number {
  return process.pid;
}

/** Who started the current process; changes if that parent dies. */
export function parentPid(): number {
  return process.ppid;
}

/** Runtime running Goiaba (bun), to start helper programs with it. */
export function runtimeExecutable(): string {
  return process.execPath;
}

/** Environment of the current process. */
export function environment(): NodeJS.ProcessEnv {
  return process.env;
}

/** Sets an environment variable only if it is not already set. */
export function setEnvironmentDefault(name: string, value: string): void {
  process.env[name] ??= value;
}

export interface ProcessUser {
  readonly uid: number | undefined;
  readonly gid: number | undefined;
}

export function currentUser(): ProcessUser {
  return { uid: process.getuid?.(), gid: process.getgid?.() };
}

/** Runs a short helper program and returns its stdout. */
export async function runProgram(
  executable: string,
  args: readonly string[],
  {
    timeoutMs,
    maxOutputBytes = HELPER_MAX_OUTPUT_BYTES,
  }: { readonly timeoutMs: number; readonly maxOutputBytes?: number },
): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
  });
  return stdout;
}

/** A long-lived helper program started by Goiaba. */
export interface Helper {
  readonly pid: number | undefined;
  /** Called once when the helper exits, for whatever reason. */
  onExit(listener: () => void): void;
  /** Kills the helper and waits until it is gone. */
  stop(): Promise<void>;
}

/**
 * Starts a long-lived helper (e.g. the jail keeper). Its stdin is a pipe held
 * by this process, so the helper can notice when Goiaba dies.
 */
export function startHelper(
  executable: string,
  args: readonly string[],
  { cwd }: { readonly cwd: string },
): Helper {
  const child = spawn(executable, [...args], {
    cwd,
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  return {
    pid: child.pid,
    onExit: (listener) => {
      child.once('exit', listener);
    },
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;

      try {
        child.kill('SIGKILL');
      } catch {
        return;
      }

      await once(child, 'close').catch(() => undefined);
    },
  };
}

/**
 * Runs a program on this process's own stdin/stdout/stderr (a launcher
 * handing over to it) and resolves with its exit code; killed by a signal,
 * 128 + the signal's number, as a shell reports it. Termination signals
 * this process gets go to the program: as a container's PID 1, nothing would
 * stop this process otherwise.
 */
export function runAttached(
  executable: string,
  args: readonly string[],
): Promise<number> {
  const child = spawn(executable, [...args], { stdio: 'inherit' });
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);

  return new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve(code ?? 128 + (signal === null ? 0 : constants.signals[signal]));
    });
  }).finally(() => {
    for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
  });
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGTERM',
  'SIGINT',
  'SIGHUP',
];

/**
 * Delivers Ctrl+C to this program. In raw terminal mode the terminal does not
 * send SIGINT itself, so a raw reader forwards the key here.
 */
export function interruptProgram(): void {
  process.kill(process.pid, 'SIGINT');
}
