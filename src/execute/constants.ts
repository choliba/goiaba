/** Defaults of execute. Each one can be changed where it is used, by the option named. */

/**
 * Two Ctrl+C within this many milliseconds are one keypress
 * (`listenForInterrupt`, option `sameKeypressMs`): under `bun run`, one
 * Ctrl+C arrives twice (the terminal's and the runner's). Half a second is
 * shorter than anyone presses twice on purpose.
 */
export const SAME_KEYPRESS_MS = 500;

/**
 * The most a short helper program may print, in bytes, before it is an error
 * (`runProgram`, option `maxOutputBytes`). Helpers answer in a line or a
 * small JSON; 2 MiB only stops one that went wrong.
 */
export const HELPER_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Milliseconds a program has to end after SIGTERM before SIGKILL
 * (`Executor`, option `killGraceMs`). Enough for a CLI to save its session;
 * short enough that a stuck one does not hold the agent.
 */
export const KILL_GRACE_MS = 2000;
