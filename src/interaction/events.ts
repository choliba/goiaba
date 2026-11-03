/**
 * What a person sends, already interpreted by an adapter: no keys, no bytes,
 * no frames. Where it came from (a terminal, a file, a web chat) is gone.
 */
export type InputEvent =
  /** A complete line: what was typed and sent, a line of a file. */
  | { readonly type: 'message'; readonly text: string }
  /** The answer to a choice that was asked (`''` for the default). */
  | { readonly type: 'choice'; readonly key: string }
  /** Stop everything (Ctrl+C on a terminal, a stop button on the web). */
  | { readonly type: 'interrupt' }
  /** A command by name (Ctrl+A on a terminal is `approvals`). */
  | { readonly type: 'command'; readonly name: string };

/** What the conversation asks of an adapter. */
export type InteractionRequest =
  /**
   * A line. Where the adapter can, a key of `instant` typed on an empty
   * line is the line at once, without Enter (e.g. `q` to quit).
   */
  | { readonly type: 'line'; readonly instant: readonly string[] }
  /** One of `keys`, answered with a single key where the adapter can. */
  | { readonly type: 'choice'; readonly keys: readonly string[] };
