import type { Output } from '../output/index';
import type { InputEvent, InteractionRequest } from './events';

/** A request the adapter took: cancel it once answered or given up. */
export interface PendingRequest {
  cancel(): void;
}

/**
 * One way of talking to a person (stdio, the TUI, a JSONL file, a web
 * chat), in both directions: it interprets what arrives into events and
 * shows what goes out. Everything about its own form (keys, the line being
 * typed, scrolling, echo) stays inside it.
 */
export interface InteractionAdapter {
  /**
   * Everything that arrives, asked for or not, until the source ends. Read
   * once; reading starts when it is first iterated.
   */
  events(): AsyncIterable<InputEvent>;
  /**
   * Asks for a line or a choice, the adapter's own way (a prompt, keys
   * taken ahead of the line, a button). `undefined` when it cannot ask (a
   * pipe, a file): the request is ignored, and what arrives still counts.
   */
  request(request: InteractionRequest): PendingRequest | undefined;
  /** Where what is shown goes. */
  readonly output: Output;
  /** Stops reading and undoes what the adapter did (raw mode, a screen). */
  close(): void;
}
