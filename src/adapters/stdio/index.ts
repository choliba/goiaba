import { UsageError } from '../../errors';
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
import { records } from './records';
import { Typing } from './typing';

export { KeyDecoder, type DecodedKey } from './keys';
export { LineEditor } from './line';
export { records } from './records';
export { Typing, type TypingOptions } from './typing';

const ESC = '\u001b';
/** Bracketed paste: the terminal marks where pasted text starts and ends. */
export const PASTE_ON = `${ESC}[?2004h`;
export const PASTE_OFF = `${ESC}[?2004l`;

/** Where an adapter reads from: stdin, unless a test gives another. */
export interface StdioSource {
  /** Someone typing (raw keys, echo) rather than a pipe or a file. */
  readonly tty: boolean;
  read(options: {
    readonly raw: boolean;
    readonly signal: AbortSignal;
  }): AsyncIterable<string>;
}

/** stdin as a source. */
export const stdinSource: StdioSource = {
  get tty() {
    return stdinIsTty();
  },
  read: (options) => readStream(options),
};

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

/**
 * The conversation over stdio. From a pipe or a file, each line is a
 * message and nothing can be asked. On a tty, keys are read raw and typed
 * (`Typing`), with their echo printed as the terminal would.
 */
export class StdioAdapter implements InteractionAdapter {
  public readonly output: Output;
  private readonly source: StdioSource;
  private readonly echo: (text: string) => void;
  private readonly maxRecordBytes: number | undefined;
  private readonly reading = new AbortController();
  private readonly incoming = new OutputStream<InputEvent>();
  private readonly typing: Typing;
  private started = false;
  private stopPasteMode: (() => void) | undefined;

  public constructor({
    shortcuts,
    maxRecordBytes,
    output = stdioOutput,
    source = stdinSource,
    echo = writeOut,
  }: StdioAdapterOptions = {}) {
    this.maxRecordBytes = maxRecordBytes;
    this.output = output;
    this.source = source;
    this.echo = echo;
    this.typing = new Typing({
      shortcuts,
      echo,
      emit: (event) => {
        this.incoming.publish(event);
      },
      end: () => {
        this.incoming.close();
      },
    });
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
    return this.typing.request(request);
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
    void readKeys(this.source, this.reading.signal, this.typing, this.incoming);
  }

  private stopTyping(): void {
    if (this.stopPasteMode === undefined) return;
    this.echo(PASTE_OFF);
    this.stopPasteMode();
    this.stopPasteMode = undefined;
  }
}

/**
 * Feeds what the terminal sends to `typing` until it ends; the end, or a
 * failure, ends `events`.
 */
export async function readKeys(
  source: StdioSource,
  signal: AbortSignal,
  typing: Typing,
  events: OutputStream<InputEvent>,
): Promise<void> {
  try {
    for await (const chunk of source.read({ raw: true, signal })) {
      typing.feed(chunk);
    }
    events.close();
  } catch (error) {
    if (signal.aborted) return;
    events.fail(error instanceof Error ? error : new Error(String(error)));
  }
}
