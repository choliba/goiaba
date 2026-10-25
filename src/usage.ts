import { loadConfig, type LoadConfigOptions } from './config/index.js';
import { UsageError } from './errors.js';
import { listenForInterrupt } from './execute/interrupt.js';
import { closeLogger, logFailure, openLogger } from './log/index.js';
import { StandardOutput, type OutputAdapter } from './output/index.js';

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
    logFailure(error);

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
