import { interruptProgram } from '../execute/process';
import { StdinReader, type StdinReaderOptions } from '../adapters/stdio/reader';
import { OutputStream } from '../execute/stream';
import { log } from '../logger/index';
import { stdioOutput, type Output } from '../output/index';
import { writeOut } from '../output/stdio';

/**
 * The conversation with whoever uses the program: what it asks and hears
 * (input) and what it shows (output). An agent, a command or the approvals
 * screen talk only through this; the terminal is one implementation
 * (`TerminalInteraction`), a web chat another.
 */
export interface Interaction {
  /** A line; where it can, a key of `instant` answers alone (no Enter). */
  ask(
    question: string,
    signal?: AbortSignal,
    instant?: readonly string[],
  ): Promise<string>;
  /** A complete unsolicited line typed while the agent is working. */
  listen?(signal?: AbortSignal): Promise<string>;
  /**
   * One of `keys`, answered with a single keypress where possible; `''` for
   * Enter (the default). Interactions without it are asked a line instead.
   */
  choose?(keys: readonly string[], signal?: AbortSignal): Promise<string>;
  close?(): void;
  write(value: string): void;
  /**
   * A reply while it is being written, piece by piece, with no line of its
   * own. Interactions without it get only whole messages (`write`).
   */
  stream?(text: string): void;
  /**
   * What the model thinks before answering, apart from the answer: whole or
   * piece by piece, as it comes. Interactions without it get it as text,
   * after a 💭.
   */
  reasoning?(text: string): void;
  /**
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it. Interactions without it get the first status as a line.
   */
  status?(text: string | undefined): void;
  /**
   * Columns of a line, for tables (columns of the screen, not characters:
   * an emoji takes two); interactions without it get `DEFAULT_LINE_LENGTH`.
   */
  lineLength?(): number;
}

export interface TerminalInteractionOptions extends Pick<
  StdinReaderOptions,
  'shortcuts' | 'urgent'
> {
  /** Where what it shows goes; stdio by default. */
  readonly output?: Output;
}

/**
 * The conversation on the terminal: hears through `StdinReader` and shows
 * through an `Output` (stdio, unless given another). The echo of what is
 * typed and Ctrl+C belong to the terminal being typed on. What it shows
 * keeps its order: a reply streams piece by piece until anything else is
 * shown, which waits for it.
 */
export class TerminalInteraction implements Interaction {
  private readonly input: StdinReader;
  private readonly output: Output;
  /** The reply streaming now, if any. */
  private streaming: OutputStream<string> | undefined;
  /** What is being shown, for the next thing to wait for. */
  private showing: Promise<void> | undefined;

  public constructor({
    output = stdioOutput,
    ...input
  }: TerminalInteractionOptions = {}) {
    this.output = output;
    this.input = new StdinReader({
      ...input,
      write: writeOut,
      // Raw mode does not send SIGINT: the terminal's Ctrl+C becomes one.
      onInterrupt: interruptProgram,
    });
  }

  public ask(
    _question: string,
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    return this.input.next(signal, instant);
  }

  public listen(signal?: AbortSignal): Promise<string> {
    return this.input.next(signal);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const key = await this.input.choose(keys, signal);
    this.write(key);
    return key;
  }

  public write(value: string): void {
    this.show(() => this.output.write(value));
  }

  public stream(text: string): void {
    if (this.streaming === undefined) {
      const pieces = new OutputStream<string>();
      this.streaming = pieces;
      this.show(() => this.output.writeStream(pieces), { keepStream: true });
    }
    this.streaming.publish(text);
  }

  public status(text: string | undefined): void {
    this.show(() => this.output.status(text));
  }

  public lineLength(): number {
    return this.output.lineLength();
  }

  /** Diagnostics for whoever runs the program, apart from its output. */
  public writeError(value: string): void {
    this.show(() => this.output.error(value));
  }

  public close(): void {
    this.endStream();
    this.input.close();
  }

  /**
   * Shows after what is being shown; at once (in the same call) when
   * nothing is, so a program that writes and exits loses nothing.
   */
  private show(task: () => Promise<void>, { keepStream = false } = {}): void {
    if (!keepStream) this.endStream();
    const previous = this.showing;
    const current = (previous === undefined ? task() : previous.then(task))
      .catch((error: unknown) => {
        log.failure(error);
      })
      .finally(() => {
        if (this.showing === current) this.showing = undefined;
      });
    this.showing = current;
  }

  private endStream(): void {
    this.streaming?.close();
    this.streaming = undefined;
  }
}
