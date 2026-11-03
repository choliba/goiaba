import { UsageError } from '../../errors';
import { DEFAULT_MAX_RECORD_BYTES } from '../constants';

const encoder = new TextEncoder();

/**
 * The lines of a stream of text, as they close: chunks join until a line
 * break, and one chunk may close several lines. The last line counts even
 * without a break at the end. A line above `maxRecordBytes` is an error,
 * never cut short in silence.
 */
export async function* records(
  pieces: AsyncIterable<string>,
  maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
): AsyncGenerator<string> {
  let open = '';

  for await (const piece of pieces) {
    const lines = (open + piece).split('\n');
    open = lines.pop() ?? '';
    for (const line of lines) yield withinLimit(stripCarriageReturn(line));
    withinLimit(open);
  }

  if (open !== '') yield withinLimit(stripCarriageReturn(open));

  function withinLimit(line: string): string {
    if (encoder.encode(line).byteLength > maxRecordBytes) {
      throw new UsageError(
        `Uma linha da entrada passou de ${String(maxRecordBytes)} bytes. Divida a entrada ou aumente maxRecordBytes.`,
      );
    }
    return line;
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
