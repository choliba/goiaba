/**
 * Defaults of the adapters. Whoever creates an adapter can change each one
 * with the option named after it.
 */

/**
 * The most a record may take, in bytes (UTF-8), before reading it is an
 * error (option `maxRecordBytes`). A record is a complete unit of meaning:
 * a line read from a pipe, a line of a JSONL file. Not a chunk: chunks are
 * what arrives each time, and their size is the system's choice. The reader
 * keeps the chunks until the record closes, so without a limit a line that
 * never ends grows in memory forever. 1 MiB holds any message a person or a
 * script sends, with room to spare.
 */
export const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;

/**
 * How often a conversation file is read for new lines, in milliseconds
 * (option `pollMs`). A person adding a line does not notice half a second;
 * reading more often only spends the disk.
 */
export const DEFAULT_POLL_MS = 500;

/**
 * Milliseconds between redraws of the TUI while text streams in
 * (`TuiAdapter`, option `frameDelayMs`): about 60 frames a second, smooth
 * without redrawing for every piece.
 */
export const DEFAULT_FRAME_DELAY_MS = 16;
