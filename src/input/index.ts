import { UsageError } from '../errors';
import { onProgramExit } from '../execute/process';

/**
 * The process's stdin as a source, and nothing else: what arrives, as text,
 * whole or piece by piece. What the text means (keys, lines, messages) is
 * up to whoever reads it. The only reader of stdin: a second one at the
 * same time is refused, so a key never reaches two readers.
 */

export interface ReadStreamOptions {
  /**
   * On a tty, each key as it is typed, without the terminal's echo or line
   * editing (raw mode); ignored when stdin is not a tty. Undone when the
   * stream ends, however it ends.
   */
  readonly raw?: boolean;
  /** Ends the stream: it stops reading and the reader gets an `AbortError`. */
  readonly signal?: AbortSignal;
}

/** Whether stdin is a tty (someone typing) rather than a pipe or a file. */
export function stdinIsTty(): boolean {
  return process.stdin.isTTY;
}

/** Everything stdin has, once it ends (e.g. the request a hook receives). */
export async function read(): Promise<string> {
  let text = '';
  for await (const piece of readStream()) text += piece;
  return text;
}

/**
 * What arrives on stdin, piece by piece, until it ends (EOF, Ctrl+D on a
 * tty). Opens on the first read, not when called; a `break` stops reading
 * and gives stdin back.
 */
export async function* readStream({
  raw = false,
  signal,
}: ReadStreamOptions = {}): AsyncGenerator<string> {
  if (ended) return;
  if (reading) {
    throw new UsageError(
      'O stdin já está sendo lido: ele tem um leitor só por vez.',
    );
  }
  signal?.throwIfAborted();

  reading = true;
  const stdin = process.stdin;
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  // Changed by the listeners while the reader waits.
  const state: { finished: boolean; failure: unknown } = {
    finished: false,
    failure: undefined,
  };
  let wake: (() => void) | undefined;
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };

  const onData = (chunk: Buffer): void => {
    const text = decoder.decode(chunk, { stream: true });
    if (text !== '') pieces.push(text);
    notify();
  };
  const onEnd = (): void => {
    ended = true;
    state.finished = true;
    const rest = decoder.decode();
    if (rest !== '') pieces.push(rest);
    notify();
  };
  const onError = (error: Error): void => {
    state.failure = error;
    notify();
  };
  const onAbort = (): void => {
    state.failure = signal?.reason;
    // Given back at once, not when the reader next resumes: whoever reads
    // stdin next may start right away.
    release();
    notify();
  };

  const rawMode = raw && stdin.isTTY;
  const restore = (): void => {
    if (rawMode) stdin.setRawMode(false);
  };
  const stopRestoring = rawMode ? onProgramExit(restore) : undefined;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    signal?.removeEventListener('abort', onAbort);
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    stdin.off('error', onError);
    stdin.pause();
    restore();
    stopRestoring?.();
    reading = false;
  };
  if (rawMode) stdin.setRawMode(true);
  stdin.on('data', onData);
  stdin.on('end', onEnd);
  stdin.on('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  stdin.resume();

  try {
    for (;;) {
      if (state.failure !== undefined) throw state.failure;
      const piece = pieces.shift();
      if (piece !== undefined) {
        yield piece;
        continue;
      }
      if (state.finished) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    release();
  }
}

/** A stream is reading stdin now. */
let reading = false;
/** stdin has ended: there is nothing left to read. */
let ended = false;
