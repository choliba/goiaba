import { readFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';

import { interruptProgram } from '../execute/process';
import { reportDebug } from '../output/activity';
import { writeOut } from '../output/terminal';

const CTRL_A = '\u0001';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\b', '\u007f']);
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ESC = '\u001b';
/** Bracketed paste: the terminal marks where pasted text starts and ends. */
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

/** A key as typed, or as part of pasted text. */
export interface DecodedKey {
  readonly key: string;
  readonly pasted: boolean;
}

/**
 * Turns what the terminal sends into keys: pasted text is marked (its line
 * breaks are text, not Enter) and escape sequences (arrows, Alt+key) are
 * dropped instead of becoming text like `[A`. Sequences may arrive split
 * across chunks.
 */
export class KeyDecoder {
  private escape: string | undefined;
  private pasting = false;

  public feed(chunk: string): DecodedKey[] {
    const keys: DecodedKey[] = [];

    for (const key of chunk) {
      if (this.escape === undefined) {
        if (key === ESC) this.escape = key;
        else keys.push({ key, pasted: this.pasting });
        continue;
      }

      const sequence = this.escape + key;
      if (sequence === PASTE_START || sequence === PASTE_END) {
        this.pasting = sequence === PASTE_START;
        this.escape = undefined;
      } else if (
        PASTE_START.startsWith(sequence) ||
        PASTE_END.startsWith(sequence)
      ) {
        this.escape = sequence;
      } else if (sequence.length === 2 && key !== '[') {
        // Alt+key or a lone Esc: the key still counts.
        this.escape = undefined;
        keys.push({ key, pasted: this.pasting });
      } else {
        // A CSI sequence (arrows…) ends at its final byte.
        this.escape =
          /[@-~]/.test(key) && sequence.length > 2 ? undefined : sequence;
      }
    }

    return keys;
  }
}

/** Everything piped to stdin, at once (e.g. the request a hook receives). */
export function readAllInput(): string {
  return readFileSync(0, 'utf8');
}

/** Owns process stdin. Consumers receive complete messages, never raw bytes. */
export class TerminalInput {
  private readonly lines = new LineInput();
  private readonly terminal = new TtyInput();

  /**
   * The next line. In a terminal, a key of `instant` typed on an empty line
   * is the answer at once, without Enter (e.g. `q` to quit).
   */
  public next(
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    if (!process.stdin.isTTY) return this.lines.next(signal);
    return this.terminal.next(signal, instant);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (process.stdin.isTTY) {
      this.terminal.pause();
      return readRawChoice(keys, signal);
    }
    return (await this.lines.next(signal)).trim().toLowerCase().charAt(0);
  }

  public close(): void {
    this.terminal.close();
    this.lines.close();
  }
}

/** Canonical input for pipes and tests; the terminal uses raw input instead. */
class LineInput {
  private readonly lines: string[] = [];
  private readonly waiting: ((line: string | undefined) => void)[] = [];
  private ended = false;
  private readonly reader: Interface;

  public constructor() {
    this.reader = createInterface({ input: process.stdin, terminal: false });
    this.reader.on('line', (line) => this.receive(line));
    this.reader.on('close', () => this.close());
    this.reader.pause();
  }

  public next(signal?: AbortSignal): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended) return Promise.reject(abortError('stdin foi fechado.'));

    return new Promise((resolve, reject) => {
      const onLine = (line: string | undefined): void => {
        signal?.removeEventListener('abort', onAbort);
        if (line === undefined) reject(abortError('stdin foi fechado.'));
        else {
          recordInput('input_submitted', { value: line });
          resolve(line);
        }
      };
      const onAbort = (): void => {
        remove(this.waiting, onLine);
        this.pauseIfIdle();
        reject(abortError('A entrada foi cancelada.'));
      };

      if (signal?.aborted === true) {
        reject(abortError('A entrada foi cancelada.'));
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(onLine);
      this.reader.resume();
    });
  }

  private receive(line: string): void {
    const waiter = this.waiting.shift();
    if (waiter === undefined) this.lines.push(line);
    else waiter(line);
    this.pauseIfIdle();
  }

  public close(): void {
    this.ended = true;
    for (const waiter of this.waiting.splice(0)) waiter(undefined);
  }

  private pauseIfIdle(): void {
    if (this.waiting.length === 0) this.reader.pause();
  }
}

interface WaitingInput {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly instant: readonly string[];
}

/** Persistent TTY listener: submitted lines stay queued during a model turn. */
class TtyInput {
  private readonly queued: string[] = [];
  private readonly waiting: WaitingInput[] = [];
  private buffer = '';
  private started = false;
  private active = false;
  private readonly decoder = new KeyDecoder();

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

  public pause(): void {
    if (!this.active) return;
    writeOut(PASTE_OFF);
    process.stdin.off('data', this.onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this.active = false;
  }

  public close(): void {
    this.pause();
    const error = abortError('stdin foi fechado.');
    for (const waiter of this.waiting.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(error);
    }
  }

  private readonly onData = (chunk: Buffer): void => {
    for (const { key, pasted } of this.decoder.feed(chunk.toString('utf8'))) {
      if (pasted) this.paste(key);
      else this.accept(key);
    }
  };

  private start(): void {
    if (this.active) return;
    this.active = true;
    process.stdin.setRawMode(true);
    // Pasted text arrives marked, so its line breaks do not submit it.
    writeOut(PASTE_ON);
    process.stdin.on('data', this.onData);
    process.stdin.resume();
  }

  /** Pasted text joins the line being typed; only a typed Enter sends it. */
  private paste(key: string): void {
    if (key === '\r' || key === '\n') {
      this.buffer += '\n';
      writeOut('\n');
      return;
    }
    if (key !== '\t' && !isPrintable(key)) return;
    if (!this.started) {
      this.started = true;
      recordInput('input_started');
    }
    this.buffer += key;
    writeOut(key);
  }

  private accept(key: string): void {
    if (key === CTRL_A) {
      writeOut('\n');
      recordInput('input_hotkey', { key: 'ctrl+a', action: 'approvals' });
      this.resetBuffer();
      // Ahead of anything queued, and the terminal stays read: whoever
      // reads next opens the approvals, and no key turns into `^A`.
      this.submit(':approvals', { first: true });
      return;
    }
    if (key === CTRL_C) {
      interruptProgram();
      this.close();
      return;
    }
    if (key === CTRL_D) {
      this.close();
      return;
    }
    if (key === '\r' || key === '\n') {
      writeOut('\n');
      recordInput('input_submitted', { value: this.buffer });
      const value = this.buffer;
      this.resetBuffer();
      this.submit(value, { first: isApprovalsCommand(value) });
      return;
    }
    if (BACKSPACE.has(key)) {
      this.erase();
      return;
    }
    if (!isPrintable(key)) return;
    if (this.buffer === '' && this.isInstant(key)) {
      writeOut(`${key}\n`);
      recordInput('input_submitted', { value: key });
      this.submit(key);
      return;
    }
    if (!this.started) {
      this.started = true;
      recordInput('input_started');
    }
    this.buffer += key;
    writeOut(key);
  }

  private isInstant(key: string): boolean {
    return this.waiting[0]?.instant.includes(key.toLowerCase()) ?? false;
  }

  private erase(): void {
    if (this.buffer.length === 0) return;
    this.buffer = removeLastGrapheme(this.buffer);
    writeOut('\b \b');
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

  private resetBuffer(): void {
    this.buffer = '';
    this.started = false;
  }
}

interface RawRead {
  readonly accept: (key: string) => string | undefined;
  readonly cancel: () => void;
}

function readRawChoice(
  keys: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  return readRaw(signal, (finish, reject): RawRead => ({
    accept(raw): string | undefined {
      const key = raw.toLowerCase();
      if (key === CTRL_C || key === CTRL_D) {
        if (key === CTRL_C) interruptProgram();
        reject(abortError('A escolha foi cancelada.'));
        return undefined;
      }
      if (key === '\r' || key === '\n') {
        recordInput('input_choice', { value: '' });
        finish('');
        return undefined;
      }
      if (!keys.includes(key)) return undefined;
      recordInput('input_choice', { value: key });
      finish(key);
      return undefined;
    },
    cancel: () => reject(abortError('A escolha foi cancelada.')),
  }));
}

function readRaw(
  signal: AbortSignal | undefined,
  create: (
    finish: (value: string) => void,
    reject: (error: Error) => void,
  ) => RawRead,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const cleanup = (): void => {
      stdin.off('data', onData);
      signal?.removeEventListener('abort', onAbort);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = (value: string): void => {
      cleanup();
      resolve(value);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const reading = create(finish, fail);
    const onAbort = (): void => reading.cancel();
    const onData = (chunk: Buffer): void => {
      for (const key of chunk.toString('utf8')) reading.accept(key);
    };

    if (signal?.aborted === true) {
      reject(abortError('A entrada foi cancelada.'));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    stdin.setRawMode(true);
    stdin.on('data', onData);
    stdin.resume();
  });
}

function isPrintable(key: string): boolean {
  return key.length > 0 && key >= ' ' && key !== '\u007f';
}

function isApprovalsCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === ':approvals' || normalized === 'bun run approvals';
}

function removeLastGrapheme(value: string): string {
  const segments = Array.from(GRAPHEMES.segment(value), (part) => part.segment);
  segments.pop();
  return segments.join('');
}

function remove<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index !== -1) values.splice(index, 1);
}

/** What was typed reaches the log through the activity channel. */
function recordInput(type: string, fields: Record<string, unknown> = {}): void {
  reportDebug({ type, ...fields });
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}
