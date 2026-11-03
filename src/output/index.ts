import { DEFAULT_LINE_LENGTH, REASONING_MARK } from './constants';
import {
  isAtLineStart,
  ttyColumns,
  writeErr,
  writeOut,
  writeStatus,
} from './stdio';

export { DEFAULT_LINE_LENGTH, REASONING_MARK } from './constants';

/**
 * What a text is: what is said (`message`), or what the model thought
 * before saying it (`reasoning`), which each destination shows apart.
 */
export type OutputKind = 'message' | 'reasoning';

/**
 * Where what the program shows goes. Only output: stdio is one destination
 * (`stdioOutput`); a file, a web page or a test is another. Every mode is
 * there, and awaited: whoever writes picks the mode it has (a whole
 * message, or pieces as they come), never checks which ones exist.
 */
export interface Output {
  /** A message, as a line: a missing `\n` at the end is added. */
  write(text: string, kind?: OutputKind): Promise<void>;
  /**
   * Pieces exactly as given, with no line of their own (a reply shown
   * while it is written), until `pieces` ends. Two streams never cross:
   * the next write waits for this one.
   */
  writeStream(
    pieces: Iterable<string> | AsyncIterable<string>,
    kind?: OutputKind,
  ): Promise<void>;
  /** Diagnostics for whoever runs the program, apart from the output. */
  error(text: string): Promise<void>;
  /**
   * A status line rewritten in place (e.g. `⏳ pensando…`); `undefined`
   * erases it.
   */
  status(text: string | undefined): Promise<void>;
  /**
   * Columns of a line, for whoever lays out text in columns. Columns of the
   * screen, not characters: an emoji takes two.
   */
  lineLength(): number;
}

/**
 * What a destination may have: only `write` is needed. The rest is made
 * from it, here and nowhere else: pieces joined into one message, errors
 * as messages, no status, and `DEFAULT_LINE_LENGTH`.
 */
export interface PartialOutput {
  write(text: string, kind?: OutputKind): Promise<void> | void;
  writeStream?(
    pieces: Iterable<string> | AsyncIterable<string>,
    kind?: OutputKind,
  ): Promise<void>;
  error?(text: string): Promise<void> | void;
  status?(text: string | undefined): Promise<void> | void;
  lineLength?(): number;
}

/** An `Output` from a destination that has only some of the modes. */
export function completeOutput(destination: PartialOutput): Output {
  const write = async (text: string, kind?: OutputKind): Promise<void> => {
    await destination.write(text, kind);
  };
  return {
    write,
    writeStream: async (pieces, kind) => {
      if (destination.writeStream !== undefined) {
        await destination.writeStream(pieces, kind);
        return;
      }
      await write(await joined(pieces), kind);
    },
    error: async (text) => {
      if (destination.error === undefined) await write(text);
      else await destination.error(text);
    },
    status: async (text) => {
      await destination.status?.(text);
    },
    lineLength: () => destination.lineLength?.() ?? DEFAULT_LINE_LENGTH,
  };
}

/**
 * stdio: stdout for messages, stderr for errors. Reasoning goes on lines of
 * its own, after `REASONING_MARK`, so the answer starts on a new line.
 */
export const stdioOutput: Output = {
  write: async (text, kind = 'message') => {
    writeOut(asLine(kind === 'reasoning' ? `${REASONING_MARK} ${text}` : text));
  },
  writeStream: async (pieces, kind = 'message') => {
    if (kind === 'message') {
      for await (const piece of pieces) writeOut(piece);
      return;
    }
    let last: string | undefined;
    for await (const piece of pieces) {
      if (last === undefined) {
        if (!isAtLineStart()) writeOut('\n');
        writeOut(`${REASONING_MARK} `);
      }
      writeOut(piece);
      last = piece;
    }
    if (last !== undefined && !last.endsWith('\n')) writeOut('\n');
  },
  error: async (text) => {
    writeErr(asLine(text));
  },
  status: async (text) => {
    writeStatus(text);
  },
  lineLength: () => ttyColumns() ?? DEFAULT_LINE_LENGTH,
};

/** The whole of a stream, once it ends. */
async function joined(
  pieces: Iterable<string> | AsyncIterable<string>,
): Promise<string> {
  let text = '';
  for await (const piece of pieces) text += piece;
  return text;
}

function asLine(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
