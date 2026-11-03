import { onProgramExit } from '../../execute/process';
import { OutputStream } from '../../execute/stream';
import { readStream, stdinIsTty } from '../../input/index';
import type {
  InputEvent,
  InteractionAdapter,
  InteractionRequest,
  PendingRequest,
} from '../../interaction/index';
import { log } from '../../logger/index';
import { stdioOutput, type Output } from '../../output/index';
import { writeOut } from '../../output/stdio';
import { UsageError } from '../../errors';
import { KeyDecoder } from './keys';
import { LineEditor } from './line';
import { records } from './records';

export { KeyDecoder, type DecodedKey } from './keys';
export { LineEditor } from './line';
export { records } from './records';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\b', '\u007f']);
const ESC = '\u001b';
/** Bracketed paste: the terminal marks where pasted text starts and ends. */
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;

/** Where the adapter reads from: stdin, unless a test gives another. */
export interface StdioSource {
  /** Someone typing (raw keys, echo) rather than a pipe or a file. */
  readonly tty: boolean;
  read(options: {
    readonly raw: boolean;
    readonly signal: AbortSignal;
  }): AsyncIterable<string>;
}

export interface StdioAdapterOptions {
  /** Keys that send a command by name (`{ '\u0001': 'approvals' }`: Ctrl+A). */
  readonly shortcuts?: Readonly<Record<string, string>>;
  /** The most a line read from a pipe may take, in bytes. */
  readonly maxRecordBytes?: number;
  /** Where what is shown goes; stdio by default. */
  readonly output?: Output;
  /** Where it reads; stdin by default. */
  readonly source?: StdioSource;
  /** Where the echo of what is typed goes; stdout by default. */
  readonly echo?: (text: string) => void;
}

const stdinSource: StdioSource = {
  get tty() {
    return stdinIsTty();
  },
  read: (options) => readStream(options),
};

/**
 * The conversation over stdio. From a pipe or a file, each line is a
 * message and nothing can be asked. On a tty, keys are read raw: what is
 * typed is echoed and edited here, pasted text keeps its line breaks,
 * Enter sends the line, a key of an `instant` answers alone, a choice takes
 * the next key ahead of the line, Ctrl+C interrupts, Ctrl+D ends the input
 * (in a choice, it is the default) and shortcuts send commands.
 */
export class StdioAdapter implements InteractionAdapter {
  public readonly output: Output;
  private readonly source: StdioSource;
  private readonly echo: (text: string) => void;
  private readonly shortcuts: ReadonlyMap<string, string>;
  private readonly maxRecordBytes: number | undefined;
  private readonly reading = new AbortController();
  private readonly incoming = new OutputStream<InputEvent>();
  private readonly line = new LineEditor();
  private readonly decoder = new KeyDecoder();
  private started = false;
  private typing = false;
  private lineRequest: { readonly instant: readonly string[] } | undefined;
  private choiceRequest: { readonly keys: readonly string[] } | undefined;
  private stopPasteMode: (() => void) | undefined;

  public constructor({
    shortcuts = {},
    maxRecordBytes,
    output = stdioOutput,
    source = stdinSource,
    echo = writeOut,
  }: StdioAdapterOptions = {}) {
    this.shortcuts = new Map(Object.entries(shortcuts));
    this.maxRecordBytes = maxRecordBytes;
    this.output = output;
    this.source = source;
    this.echo = echo;
  }

  public async *events(): AsyncGenerator<InputEvent> {
    if (this.started) {
      throw new UsageError('Os eventos de um adapter são lidos uma vez só.');
    }
    this.started = true;

    if (!this.source.tty) {
      const lines = records(
        this.source.read({ raw: false, signal: this.reading.signal }),
        this.maxRecordBytes,
      );
      for await (const text of lines) {
        log.debug({ type: 'input_submitted', value: text });
        yield { type: 'message', text };
      }
      return;
    }

    this.startTyping();
    try {
      yield* this.incoming;
    } finally {
      this.stopTyping();
    }
  }

  public request(request: InteractionRequest): PendingRequest | undefined {
    // A pipe or a file shows nothing and has no keys to take.
    if (!this.source.tty) return undefined;
    if (request.type === 'line') {
      const taken = { instant: request.instant };
      this.lineRequest = taken;
      return {
        cancel: () => {
          if (this.lineRequest === taken) this.lineRequest = undefined;
        },
      };
    }
    const taken = { keys: request.keys };
    this.choiceRequest = taken;
    return {
      cancel: () => {
        if (this.choiceRequest === taken) this.choiceRequest = undefined;
      },
    };
  }

  public close(): void {
    this.reading.abort();
    this.incoming.close();
    this.stopTyping();
  }

  private startTyping(): void {
    // Pasted text arrives marked, so its line breaks do not submit it.
    this.echo(PASTE_ON);
    this.stopPasteMode = onProgramExit(() => {
      this.echo(PASTE_OFF);
    });
    void this.consume();
  }

  private stopTyping(): void {
    if (this.stopPasteMode === undefined) return;
    this.echo(PASTE_OFF);
    this.stopPasteMode();
    this.stopPasteMode = undefined;
  }

  private async consume(): Promise<void> {
    const signal = this.reading.signal;
    try {
      for await (const chunk of this.source.read({ raw: true, signal })) {
        this.onData(chunk);
      }
      this.incoming.close();
    } catch (error) {
      if (signal.aborted) return;
      this.incoming.fail(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private onData(chunk: string): void {
    for (const { key, pasted } of this.decoder.feed(chunk)) {
      // A choice takes typed keys only; pasted text cannot answer it.
      if (this.choiceRequest !== undefined) {
        if (!pasted) this.answerChoice(key, this.choiceRequest.keys);
      } else if (pasted) this.paste(key);
      else this.accept(key);
    }
  }

  /** Pasted text joins the line being typed; only a typed Enter sends it. */
  private paste(key: string): void {
    if (key === '\r' || key === '\n') {
      this.line.insert('\n');
      this.echo('\n');
      return;
    }
    if (key !== '\t' && !isPrintable(key)) return;
    this.type(key);
  }

  private accept(key: string): void {
    const command = this.shortcuts.get(key);
    if (command !== undefined) {
      this.echo('\n');
      log.debug({ type: 'input_shortcut', value: command });
      this.resetLine();
      this.emit({ type: 'command', name: command });
      return;
    }
    if (key === CTRL_C) {
      this.emit({ type: 'interrupt' });
      return;
    }
    if (key === CTRL_D) {
      this.incoming.close();
      return;
    }
    if (key === '\r' || key === '\n') {
      this.echo('\n');
      const text = this.line.text;
      log.debug({ type: 'input_submitted', value: text });
      this.resetLine();
      this.emit({ type: 'message', text });
      return;
    }
    if (BACKSPACE.has(key)) {
      if (this.line.erase()) this.echo('\b \b');
      return;
    }
    if (!isPrintable(key)) return;
    if (
      this.line.text === '' &&
      this.lineRequest?.instant.includes(key.toLowerCase()) === true
    ) {
      this.echo(`${key}\n`);
      log.debug({ type: 'input_submitted', value: key });
      this.emit({ type: 'message', text: key });
      return;
    }
    this.type(key);
  }

  private type(key: string): void {
    if (!this.typing) {
      this.typing = true;
      log.debug({ type: 'input_started' });
    }
    this.line.insert(key);
    this.echo(key);
  }

  /** Ctrl+C interrupts, Ctrl+D is the default; other keys outside wait. */
  private answerChoice(raw: string, keys: readonly string[]): void {
    const key = raw.toLowerCase();
    if (key === CTRL_C) {
      this.emit({ type: 'interrupt' });
      return;
    }
    const value = key === '\r' || key === '\n' || key === CTRL_D ? '' : key;
    if (value !== '' && !keys.includes(value)) return;

    // The conversation shows the answer.
    log.debug({ type: 'input_choice', value });
    this.choiceRequest = undefined;
    this.emit({ type: 'choice', key: value });
  }

  private emit(event: InputEvent): void {
    this.incoming.publish(event);
  }

  private resetLine(): void {
    this.line.take();
    this.typing = false;
  }
}

function isPrintable(key: string): boolean {
  return key.length > 0 && key >= ' ' && key !== '\u007f';
}
