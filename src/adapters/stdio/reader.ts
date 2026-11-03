import { onProgramExit } from '../../execute/process';
import { readStream, stdinIsTty } from '../../input/index';
import { log } from '../../logger/index';
import { KeyDecoder } from './keys';
import { LineEditor } from './line';
import { records } from './records';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\b', '\u007f']);
const ESC = '\u001b';
/** Bracketed paste: the terminal marks where pasted text starts and ends. */
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;

/**
 * What reading does besides reading, decided by whoever creates the
 * reader: it knows nothing of the screen, the process or what a line means.
 */
export interface StdinReaderOptions {
  /**
   * What the reader writes to the terminal: the echo of what is typed (raw
   * mode shows nothing by itself) and the sequences that mark pasted text.
   * Without it, nothing is shown and a paste's line breaks submit it.
   */
  readonly write?: (text: string) => void;
  /** Ctrl+C: raw mode does not send SIGINT, so someone has to. */
  readonly onInterrupt?: () => void;
  /** A key that submits a line of its own, ahead of the queue (Ctrl+A → `:approvals`). */
  readonly shortcuts?: Readonly<Record<string, string>>;
  /** Typed lines that go ahead of the queue. */
  readonly urgent?: (line: string) => boolean;
  /**
   * The keys that are not text, as the terminal sends them (`\u001b[A` for
   * ↑, `\u001b[5~` for PageUp…): nothing else is done with them.
   */
  readonly onSequence?: (sequence: string) => void;
  /** The most a line read from a pipe may take, in bytes. */
  readonly maxRecordBytes?: number;
}

/**
 * Lines and one-key choices from stdin: typed on a tty (raw, with echo and
 * pasting), or read from a pipe. Consumers receive complete messages, never
 * raw bytes.
 */
export class StdinReader {
  private readonly lines: PipeLines;
  private readonly terminal: TtyInput;
  private readonly tty = stdinIsTty();

  public constructor(options: StdinReaderOptions = {}) {
    this.lines = new PipeLines(options.maxRecordBytes);
    this.terminal = new TtyInput(options);
  }

  /**
   * The next line. In a terminal, a key of `instant` typed on an empty line
   * is the answer at once, without Enter (e.g. `q` to quit).
   */
  public next(
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    if (!this.tty) return this.lines.next(signal);
    return this.terminal.next(signal, instant);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.tty) return this.terminal.choose(keys, signal);
    return (await this.lines.next(signal)).trim().toLowerCase().charAt(0);
  }

  public close(): void {
    this.terminal.close();
    this.lines.close();
  }
}

/** Lines read from a pipe or a file, one per request. */
class PipeLines {
  private readonly controller = new AbortController();
  private iterator: AsyncIterator<string> | undefined;
  /** A line asked for whose reader gave up: the next one gets it. */
  private pending: Promise<IteratorResult<string>> | undefined;
  private closed = false;

  public constructor(private readonly maxRecordBytes: number | undefined) {}

  public async next(signal?: AbortSignal): Promise<string> {
    if (this.closed) throw abortError('stdin foi fechado.');
    if (signal?.aborted === true) throw abortError('A entrada foi cancelada.');

    this.iterator ??= records(
      readStream({ signal: this.controller.signal }),
      this.maxRecordBytes,
    )[Symbol.asyncIterator]();
    if (this.pending === undefined) {
      this.pending = this.iterator.next();
      // Read later, or never if the input is closed first.
      this.pending.catch(() => undefined);
    }

    let result: IteratorResult<string>;
    try {
      result = await untilAborted(this.pending, signal);
    } catch (error) {
      // Closed while waiting: the line asked for will never come.
      if (this.isClosed()) throw abortError('stdin foi fechado.');
      // Only this reader gave up: the line asked for goes to the next one.
      if (!isAborted(signal)) this.pending = undefined;
      throw error;
    }
    this.pending = undefined;

    if (result.done === true) {
      this.closed = true;
      throw abortError('stdin foi fechado.');
    }
    recordInput('input_submitted', { value: result.value });
    return result.value;
  }

  public close(): void {
    this.closed = true;
    this.controller.abort();
  }

  private isClosed(): boolean {
    return this.closed;
  }
}

interface WaitingInput {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly instant: readonly string[];
}

interface WaitingChoice {
  readonly keys: readonly string[];
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

/**
 * Persistent TTY listener: submitted lines stay queued during a model turn.
 * The only reader of the terminal: one-key choices (e.g. approvals) are answered
 * here too, ahead of the line being typed, so a key never reaches two
 * readers.
 */
class TtyInput {
  public constructor(private readonly options: StdinReaderOptions) {}

  private readonly queued: string[] = [];
  private readonly waiting: WaitingInput[] = [];
  private readonly choices: WaitingChoice[] = [];
  private readonly line = new LineEditor();
  private started = false;
  private reading: AbortController | undefined;
  private stopPasteMode: (() => void) | undefined;
  private readonly decoder = new KeyDecoder((sequence) => {
    this.options.onSequence?.(sequence);
  });

  public next(
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);

    this.start();
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const waiting = this.waiting.find((item) => item.onAbort === onAbort);
        if (waiting !== undefined) remove(this.waiting, waiting);
        reject(abortError('A entrada foi cancelada.'));
      };
      if (signal?.aborted === true) {
        reject(abortError('A entrada foi cancelada.'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push({ resolve, reject, signal, onAbort, instant });
    });
  }

  /** One of `keys` (or `''` for Enter), before any line being typed. */
  public choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    this.start();
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const waiting = this.choices.find((item) => item.onAbort === onAbort);
        if (waiting !== undefined) remove(this.choices, waiting);
        reject(abortError('A escolha foi cancelada.'));
      };
      if (signal?.aborted === true) {
        reject(abortError('A escolha foi cancelada.'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.choices.push({ keys, resolve, reject, signal, onAbort });
    });
  }

  public close(): void {
    this.stop();
    this.fail(abortError('stdin foi fechado.'));
  }

  private start(): void {
    if (this.reading !== undefined) return;
    const reading = new AbortController();
    this.reading = reading;
    // Pasted text arrives marked, so its line breaks do not submit it.
    this.write(PASTE_ON);
    this.stopPasteMode = onExitWrite(this.options.write, PASTE_OFF);
    void this.consume(reading.signal);
  }

  private stop(): void {
    if (this.reading === undefined) return;
    this.write(PASTE_OFF);
    this.stopPasteMode?.();
    this.stopPasteMode = undefined;
    this.reading.abort();
    this.reading = undefined;
  }

  private async consume(signal: AbortSignal): Promise<void> {
    try {
      for await (const chunk of readStream({ raw: true, signal })) {
        this.onData(chunk);
      }
      // stdin ended: nobody can type anything else.
      if (!signal.aborted) this.close();
    } catch (error) {
      if (signal.aborted) return;
      this.stop();
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private fail(error: Error): void {
    for (const waiter of [
      ...this.choices.splice(0),
      ...this.waiting.splice(0),
    ]) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(error);
    }
  }

  private onData(chunk: string): void {
    for (const { key, pasted } of this.decoder.feed(chunk)) {
      // A choice takes typed keys only; pasted text cannot answer it.
      if (this.choices.length > 0) {
        if (!pasted) this.answerChoice(key);
      } else if (pasted) this.paste(key);
      else this.accept(key);
    }
  }

  /** Pasted text joins the line being typed; only a typed Enter sends it. */
  private paste(key: string): void {
    if (key === '\r' || key === '\n') {
      this.line.insert('\n');
      this.write('\n');
      return;
    }
    if (key !== '\t' && !isPrintable(key)) return;
    this.type(key);
  }

  private accept(key: string): void {
    const shortcut = this.options.shortcuts?.[key];
    if (shortcut !== undefined) {
      this.write('\n');
      recordInput('input_shortcut', { value: shortcut });
      this.resetLine();
      // Ahead of anything queued, and the terminal stays read: whoever
      // reads next gets the shortcut's line, and no key turns into `^A`.
      this.submit(shortcut, { first: true });
      return;
    }
    if (key === CTRL_C) {
      this.options.onInterrupt?.();
      this.close();
      return;
    }
    if (key === CTRL_D) {
      this.close();
      return;
    }
    if (key === '\r' || key === '\n') {
      this.write('\n');
      const value = this.line.text;
      recordInput('input_submitted', { value });
      this.resetLine();
      this.submit(value, { first: this.options.urgent?.(value) ?? false });
      return;
    }
    if (BACKSPACE.has(key)) {
      if (this.line.erase()) this.write('\b \b');
      return;
    }
    if (!isPrintable(key)) return;
    if (this.line.text === '' && this.isInstant(key)) {
      this.write(`${key}\n`);
      recordInput('input_submitted', { value: key });
      this.submit(key);
      return;
    }
    this.type(key);
  }

  private type(key: string): void {
    if (!this.started) {
      this.started = true;
      recordInput('input_started');
    }
    this.line.insert(key);
    this.write(key);
  }

  /** Ctrl+C interrupts, Ctrl+D cancels; other keys outside the choice wait. */
  private answerChoice(raw: string): void {
    const choice = this.choices.at(0);
    if (choice === undefined) return;
    const key = raw.toLowerCase();

    if (key === CTRL_C) {
      this.options.onInterrupt?.();
      this.close();
      return;
    }
    if (key === CTRL_D) {
      this.settleChoice(choice);
      choice.reject(abortError('A escolha foi cancelada.'));
      return;
    }
    const value = key === '\r' || key === '\n' ? '' : key;
    if (value !== '' && !choice.keys.includes(value)) return;

    // The output side shows the answer (see TerminalInteraction.choose).
    recordInput('input_choice', { value });
    this.settleChoice(choice);
    choice.resolve(value);
  }

  private settleChoice(choice: WaitingChoice): void {
    remove(this.choices, choice);
    choice.signal?.removeEventListener('abort', choice.onAbort);
  }

  private isInstant(key: string): boolean {
    return this.waiting[0]?.instant.includes(key.toLowerCase()) ?? false;
  }

  private submit(value: string, { first = false } = {}): void {
    const waiter = this.waiting.shift();
    if (waiter === undefined) {
      if (first) this.queued.unshift(value);
      else this.queued.push(value);
      return;
    }
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(value);
  }

  private write(text: string): void {
    this.options.write?.(text);
  }

  private resetLine(): void {
    this.line.take();
    this.started = false;
  }
}

/** Writes `text` when the program ends, if it still has to be undone. */
function onExitWrite(
  write: ((text: string) => void) | undefined,
  text: string,
): (() => void) | undefined {
  if (write === undefined) return undefined;
  return onProgramExit(() => {
    write(text);
  });
}

/** `promise`, or an `AbortError` as soon as `signal` aborts. */
function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError('A entrada foi cancelada.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isPrintable(key: string): boolean {
  return key.length > 0 && key >= ' ' && key !== '\u007f';
}

function remove<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index !== -1) values.splice(index, 1);
}

/** What was typed goes to the log (debug). */
function recordInput(type: string, fields: Record<string, unknown> = {}): void {
  log.debug({ type, ...fields });
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}
