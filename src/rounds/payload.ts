/**
 * The records of `rounds.data` as the rounds' pages fetch them
 * (`rounds.json`): served by `goiaba rounds:web` (pages.ts) and, in this
 * repository's development, by the pages' Vite. Only the disk, no server:
 * Vite's config imports it too.
 */

import {
  join,
  listDirectory,
  pathExists,
  readText,
} from '../filesystem/index.ts';

/** Every record of `data`, by file name, as the pages read them. */
export function roundsPayload(data: string): string {
  const records = pathExists(data)
    ? listDirectory(data)
        .filter((name) => name.endsWith('.json'))
        .toSorted()
        .map((file) => ({
          file,
          record: JSON.parse(readText(join(data, file))) as unknown,
        }))
    : [];
  return JSON.stringify(records);
}
