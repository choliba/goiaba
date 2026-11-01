import { terminalColumns, writeErr, writeOut, writeStatus } from './terminal';

/**
 * Where what the program shows goes. Only output: the terminal is one
 * destination (`terminalOutput`); a file, a web page or a test is another,
 * by writing an object with these methods.
 */
export interface Output {
  /** A message, as a line: a missing `\n` at the end is added. */
  write(text: string): void;
  /**
   * Text exactly as given, with no line of its own: a reply shown while it
   * is being written. Outputs without it get only whole messages.
   */
  stream?(text: string): void;
  /** Diagnostics for whoever runs the program, apart from the output. */
  error?(text: string): void;
  /**
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it. Outputs without it show no status.
   */
  status?(text: string | undefined): void;
  /** Characters per line, for tables; outputs without it get 120. */
  width?(): number;
}

const DEFAULT_WIDTH = 120;

/** The terminal: stdout for messages, stderr for errors. */
export const terminalOutput: Output = {
  write: (text) => {
    writeOut(asLine(text));
  },
  stream: writeOut,
  error: (text) => {
    writeErr(asLine(text));
  },
  status: writeStatus,
  width: () => terminalColumns() ?? DEFAULT_WIDTH,
};

function asLine(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
