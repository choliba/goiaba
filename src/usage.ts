import { loadConfig, type LoadConfigOptions } from './config/index';
import { UsageError } from './errors';
import { listenForInterrupt } from './execute/interrupt';
import { exitProgram, onUncaughtError } from './execute/process';
import { closeLogger, log, openLogger } from './logger/index';
import { writeErr } from './output/terminal';
import { StandardOutput, type OutputAdapter } from './output/index';

export { UsageError };

export interface ScriptContext {
  /** Aborted on the first Ctrl+C; agents created in the script use it by default. */
  readonly signal: AbortSignal;
}

export interface RunScriptOptions {
  /** Where usage errors are shown; defaults to stdout. */
  readonly output?: OutputAdapter;
  /** Which goiaba.config to load; defaults to the one found from the cwd. */
  readonly config?: LoadConfigOptions;
}

let current: AbortSignal | undefined;

/** Signal of the running script, if any. */
export function scriptSignal(): AbortSignal | undefined {
  return current;
}

export async function runScript(
  start: (context: ScriptContext) => Promise<void>,
  { output = new StandardOutput(), config = {} }: RunScriptOptions = {},
): Promise<void> {
  const interrupt = listenForInterrupt();
  current = interrupt.signal;

  try {
    await loadConfig(config);
    // One log for the whole script, shared by every agent it runs.
    openLogger();
    await start({ signal: interrupt.signal });
  } catch (error) {
    log.failure(error);

    if (error instanceof UsageError) {
      output.write(error.message);
      return;
    }

    throw error;
  } finally {
    closeLogger();
    interrupt.dispose();
    current = undefined;
  }
}

let handling = false;

/**
 * Errors nobody caught, as `runScript` shows them: a usage error (a policy
 * Goiaba cannot apply, a busy port, a wrong root) is its message, without a
 * stack trace; anything else, its stack. Either ends the program with 1.
 * Installed once, when Goiaba is imported, so an agent file needs no
 * `runScript` for it.
 */
export function showUncaughtErrors(): void {
  if (handling) return;
  handling = true;

  onUncaughtError((error) => {
    log.failure(error);
    closeLogger();
    if (error instanceof UsageError) {
      writeErr(`${error.message}\n`);
    } else {
      writeErr(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
    }
    exitProgram(1);
  });
}
