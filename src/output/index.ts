import { readAllInput, TerminalInput } from '../input/index';
import { terminalColumns, writeErr, writeOut, writeStatus } from './terminal';

export interface OutputAdapter {
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
   * Enter (the default). Adapters without it are asked a line instead.
   */
  choose?(keys: readonly string[], signal?: AbortSignal): Promise<string>;
  close?(): void;
  write(value: string): void;
  /**
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it. Adapters without it get the first status as a line.
   */
  status?(text: string | undefined): void;
  /** Characters per line, for tables; adapters without it get 120. */
  width?(): number;
}

const DEFAULT_WIDTH = 120;

export class StandardOutput implements OutputAdapter {
  private readonly input = new TerminalInput();

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
    this.write(key === '' ? '' : key);
    return key;
  }

  public write(value: string): void {
    writeOut(value.endsWith('\n') ? value : `${value}\n`);
  }

  public status(text: string | undefined): void {
    writeStatus(text);
  }

  /** Width of the terminal, in characters; 120 when not a terminal. */
  public width(): number {
    return terminalColumns() ?? DEFAULT_WIDTH;
  }

  /** Diagnostics for whoever runs the program, apart from its output. */
  public writeError(value: string): void {
    writeErr(value.endsWith('\n') ? value : `${value}\n`);
  }

  /** Everything piped to stdin, for programs fed one request (e.g. a hook). */
  public readInput(): string {
    return readAllInput();
  }

  public close(): void {
    this.input.close();
  }
}
