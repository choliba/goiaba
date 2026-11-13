/**
 * A size as people write it, with its unit: `'500k'`, `'1024kb'`, `'10m'`,
 * `'20mb'`, `'50M'`, `'1g'`, `'2gb'` (any case, decimals allowed: `'1.5mb'`).
 * Binary units, as `du -h` and file managers show: 1 k is 1024 bytes.
 */

/** Bytes in each unit. */
const UNITS: ReadonlyMap<string, number> = new Map([
  ['b', 1],
  ['k', 1024],
  ['kb', 1024],
  ['m', 1024 ** 2],
  ['mb', 1024 ** 2],
  ['g', 1024 ** 3],
  ['gb', 1024 ** 3],
]);

const SIZE = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i;

/** The size in bytes; `undefined` when the text is not a positive size with a unit. */
export function parseSize(text: string): number | undefined {
  const match = SIZE.exec(text);
  if (match === null) return undefined;
  const [, amount = '', unit = ''] = match;
  const bytes = UNITS.get(unit.toLowerCase());
  if (bytes === undefined) return undefined;
  const size = Math.round(Number(amount) * bytes);
  return size > 0 ? size : undefined;
}

/** How a size is written, for the error messages. */
export const SIZE_EXAMPLES = "'500k', '20mb', '1g'";
