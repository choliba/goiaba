export type { InteractionAdapter, PendingRequest } from './adapter';
export { DEFAULT_MAX_UNANSWERED_REQUESTS } from './constants';
export { Conversation, type ConversationOptions } from './conversation';
export type { InputEvent, InteractionRequest } from './events';

/**
 * The conversation with whoever uses the program: what it asks and hears
 * (input) and what it shows (output). An agent, a command or the approvals
 * screen talk only through this. `Conversation` is the one implementation,
 * over an adapter (stdio, the TUI, a file, a web chat).
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
  /** Diagnostics for whoever runs the program, apart from what it shows. */
  error?(text: string): void;
  /**
   * Columns of a line, for tables (columns of the screen, not characters:
   * an emoji takes two); interactions without it get `DEFAULT_LINE_LENGTH`.
   */
  lineLength?(): number;
}
