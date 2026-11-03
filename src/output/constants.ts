/** Defaults of the output. */

/**
 * Columns of a line when the destination has no lines of its own (a pipe, a
 * file), for whoever lays out text in columns (the approvals table). In
 * columns of the screen, not characters: an emoji takes two. 120 fits a
 * table of commands without wrapping on most screens and in most logs.
 */
export const DEFAULT_LINE_LENGTH = 120;
