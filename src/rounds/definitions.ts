/**
 * Where a round's declaration lives in `rounds/definitions`: one file,
 * `<id>.ts`, or a folder of its own, `<id>/<id>.ts`, whose other files are
 * pieces the declaration imports (a policy, the prompts), not rounds.
 */

import { UsageError } from '../errors';
import {
  isDirectory,
  join,
  listDirectory,
  pathExists,
} from '../filesystem/index';
import { ROUNDS_DEFINITIONS_DIR } from './constants';

/** The ids of every round declared in `dir`, sorted. */
export function listDefinitions(dir: string): string[] {
  if (!pathExists(dir)) return [];
  return listDirectory(dir)
    .flatMap((name) => {
      if (name.endsWith('.ts')) return [name.slice(0, -'.ts'.length)];
      const folder = join(dir, name);
      return isDirectory(folder) && pathExists(join(folder, `${name}.ts`))
        ? [name]
        : [];
    })
    .toSorted();
}

/**
 * The file of round `id` in `dir`. Neither form, or both at once (which one
 * runs would be a guess), is a `UsageError` saying what to do.
 */
export function findDefinition(dir: string, id: string): string {
  const file = join(dir, `${id}.ts`);
  const inFolder = join(dir, id, `${id}.ts`);
  const asFile = pathExists(file);
  const asFolder = pathExists(inFolder);
  if (asFile && asFolder) {
    throw new UsageError(
      `A rodada ${id} está declarada duas vezes: ${ROUNDS_DEFINITIONS_DIR}/${id}.ts e ${ROUNDS_DEFINITIONS_DIR}/${id}/${id}.ts. Apague uma das duas.`,
    );
  }
  if (asFile) return file;
  if (asFolder) return inFolder;
  const available = listDefinitions(dir);
  throw new UsageError(
    `Não há a rodada ${id} em ${ROUNDS_DEFINITIONS_DIR} (nem ${id}.ts, nem ${id}/${id}.ts). ${available.length === 0 ? 'Não há nenhuma.' : `As que existem: ${available.join(', ')}.`}`,
  );
}
