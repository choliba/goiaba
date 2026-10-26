/**
 * The only writer of the process's stdout and stderr: StandardOutput and the
 * terminal input's echo both go through here.
 */
export function writeOut(text: string): void {
  process.stdout.write(text);
}

export function writeErr(text: string): void {
  process.stderr.write(text);
}

/** Columns of the terminal, or `undefined` when stdout is not one. */
export function terminalColumns(): number | undefined {
  return process.stdout.isTTY ? process.stdout.columns : undefined;
}
