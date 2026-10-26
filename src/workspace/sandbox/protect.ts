import { pathExists } from '../../filesystem/index';
import type { FilesystemMask } from '../../policy/index';

/** Read-only masks for protected paths; missing paths have nothing to protect. */
export function protectedMasks(paths: readonly string[]): FilesystemMask[] {
  return [...new Set(paths)]
    .filter((path) => pathExists(path))
    .map((path) => ({ path, access: 'readonly' }));
}
