import { loadConfig } from './config/index.js';
import { UsageError } from './errors.js';

export { UsageError };

export interface ScriptContext {
  /** Aborted on the first Ctrl+C; agents created in the script use it by default. */
  readonly signal: AbortSignal;
}

let current: AbortSignal | undefined;

/** Signal of the running script, if any. */
export function scriptSignal(): AbortSignal | undefined {
  return current;
}

export async function runScript(
  start: (context: ScriptContext) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  // First Ctrl+C stops the agent and lets it clean up; the second one forces exit.
  const onInterrupt = (): void => {
    if (controller.signal.aborted) {
      process.exit(130);
    }

    controller.abort();
  };

  current = controller.signal;
  process.on('SIGINT', onInterrupt);

  try {
    await loadConfig();
    await start({ signal: controller.signal });
  } catch (error) {
    if (error instanceof UsageError) {
      process.stdout.write(
        error.message.endsWith('\n') ? error.message : `${error.message}\n`,
      );
      return;
    }

    throw error;
  } finally {
    process.off('SIGINT', onInterrupt);
    current = undefined;
  }
}
