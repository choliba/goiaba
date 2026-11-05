/**
 * The `file:line` references an agent cites (`src/usuarios.ts:8`,
 * `package.json:10-13`), checked against the workspace as it was at the
 * round's start (the git tag): the file must exist and the line must be in
 * it. Pure parsing here; reading the files is the caller's.
 */

import type { References } from './types';

/** `path/file.ext:12` or `:12-15`; a path has at least one `.`. */
const REFERENCE =
  /(?<![\w/.-])((?:[\w-]+\/)*[\w.-]+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?/g;

export interface Reference {
  /** As cited: `src/usuarios.ts:8-12`. */
  readonly text: string;
  readonly path: string;
  /** The last line it points at. */
  readonly line: number;
}

/** Every distinct reference in `text`, in order. */
export function parseReferences(text: string): Reference[] {
  const seen = new Map<string, Reference>();
  for (const match of text.matchAll(REFERENCE)) {
    // The end group is optional: undefined when the reference is one line.
    const groups: readonly (string | undefined)[] = match;
    const [whole = '', path, start, end] = groups;
    if (path === undefined || start === undefined) continue;
    const line = Number(end ?? start);
    if (line < 1 || seen.has(whole)) continue;
    seen.set(whole, { text: whole, path, line });
  }
  return [...seen.values()];
}

/**
 * The references checked: `lines(path)` says how many lines the file had at
 * the start, `undefined` when it did not exist.
 */
export async function checkReferences(
  text: string,
  lines: (path: string) => Promise<number | undefined>,
): Promise<References> {
  const references = parseReferences(text);
  const invalid: string[] = [];
  for (const reference of references) {
    const count = await lines(reference.path);
    if (count === undefined || reference.line > count) {
      invalid.push(reference.text);
    }
  }
  return {
    cited: references.length,
    valid: references.length - invalid.length,
    invalid,
  };
}
