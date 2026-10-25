/** Ctrl+C of the current process, as an AbortSignal. */
export interface Interrupt {
  /** Aborted on the first Ctrl+C. */
  readonly signal: AbortSignal;
  /** Stops listening; call when the work the signal guards is over. */
  dispose(): void;
}

const SAME_KEYPRESS_MS = 500;

/**
 * The first Ctrl+C aborts `signal` so the work can clean up; a second one
 * forces the process out. Under `bun run` one Ctrl+C arrives twice (terminal
 * and runner), so a repeat within a short window is the same keypress.
 */
export function listenForInterrupt(): Interrupt {
  const controller = new AbortController();
  let abortedAt = 0;

  const onInterrupt = (): void => {
    if (!controller.signal.aborted) {
      abortedAt = Date.now();
      controller.abort();
    } else if (Date.now() - abortedAt > SAME_KEYPRESS_MS) {
      process.exit(130);
    }
  };

  process.on('SIGINT', onInterrupt);

  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', onInterrupt);
    },
  };
}
