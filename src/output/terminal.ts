/**
 * The only writer of the process's stdout and stderr: `terminalOutput` and
 * the echo of what is typed both go through here.
 */

const CLEAR_LINE = '\r\u001b[2K';
/** Escape sequences: they change no text on screen. */
// oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
const ESCAPES = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** The status line on screen now, if any (see {@link writeStatus}). */
let status: string | undefined;
/** The cursor is at the start of a line: nothing typed or half-written. */
let atLineStart = true;

export function writeOut(text: string): void {
  clearStatus();
  process.stdout.write(text);
  track(text);
}

export function writeErr(text: string): void {
  clearStatus();
  process.stderr.write(text);
  track(text);
}

/**
 * A line that each call rewrites in place (e.g. `⏳ pensando…`), and
 * `undefined` erases; anything else written erases it first. Only on a
 * terminal, and only at the start of a line, so it never covers what is
 * being typed.
 */
export function writeStatus(text: string | undefined): void {
  if (!process.stdout.isTTY) return;
  if (text === undefined) {
    clearStatus();
    return;
  }
  if (status === undefined && !atLineStart) return;
  if (text === status) return;

  process.stdout.write(`${CLEAR_LINE}${text}`);
  status = text;
}

/** Columns of the terminal, or `undefined` when stdout is not one. */
export function terminalColumns(): number | undefined {
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}

function clearStatus(): void {
  if (status === undefined) return;
  process.stdout.write(CLEAR_LINE);
  status = undefined;
  atLineStart = true;
}

function track(text: string): void {
  const visible = text.replace(ESCAPES, '');
  if (visible.length > 0) atLineStart = visible.endsWith('\n');
}
