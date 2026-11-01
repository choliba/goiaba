import { interruptProgram } from '../execute/process';
import {
  readAllInput,
  StdinReader,
  type StdinReaderOptions,
} from '../input/index';
import { terminalOutput, type Output } from '../output/index';
import { writeOut } from '../output/terminal';

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
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it. Interactions without it get the first status as a line.
   */
  status?(text: string | undefined): void;
  /** Characters per line, for tables; interactions without it get 120. */
  width?(): number;
}

export interface TerminalInteractionOptions extends Pick<
  StdinReaderOptions,
  'shortcuts' | 'urgent'
> {
  /** Where what it shows goes; the terminal by default. */
  readonly output?: Output;
}

const DEFAULT_WIDTH = 120;

/**
 * The conversation on the terminal: hears through `StdinReader` and shows
 * through an `Output` (the terminal, unless given another). The echo of
 * what is typed and Ctrl+C belong to the terminal being typed on.
 */
export class TerminalInteraction implements Interaction {
  private readonly input: StdinReader;
  private readonly output: Output;

  public constructor({
    output = terminalOutput,
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
    this.output.write(value);
  }

  public status(text: string | undefined): void {
    this.output.status?.(text);
  }

  public width(): number {
    return this.output.width?.() ?? DEFAULT_WIDTH;
  }

  /** Diagnostics for whoever runs the program, apart from its output. */
  public writeError(value: string): void {
    if (this.output.error === undefined) this.output.write(value);
    else this.output.error(value);
  }

  /** Everything piped to stdin, for programs fed one request (e.g. a hook). */
  public readInput(): string {
    return readAllInput();
  }

  public close(): void {
    this.input.close();
  }
}
