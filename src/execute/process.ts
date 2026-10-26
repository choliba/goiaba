import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants, homedir } from 'node:os';
import { promisify } from 'node:util';
import { join } from '../filesystem/index';

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

/** The code the program ends with, without ending it now. */
export function setExitCode(code: number): void {
  process.exitCode = code;
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

/** Goiaba's cache directory (`$XDG_CACHE_HOME/goiaba`, default `~/.cache/goiaba`). */
export function goiabaCacheDir(): string {
  const cache = environment()['XDG_CACHE_HOME'];
  return join(
    cache === undefined || cache.length === 0
      ? join(homedir(), '.cache')
      : cache,
    'goiaba',
  );
}

/** Runs a short helper program and returns its stdout. */
export async function runProgram(
  executable: string,
  args: readonly string[],
  { timeoutMs }: { readonly timeoutMs: number },
): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
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
