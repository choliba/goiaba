import { loadConfig } from './config/index.js';
import { UsageError } from './errors.js';

export { UsageError };

export async function runScript(start: () => Promise<void>): Promise<void> {
  try {
    await loadConfig();
    await start();
  } catch (error) {
    if (error instanceof UsageError) {
      process.stdout.write(
        error.message.endsWith('\n') ? error.message : `${error.message}\n`,
      );
      return;
    }

    throw error;
  }
}
