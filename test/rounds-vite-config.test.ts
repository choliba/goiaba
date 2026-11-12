/**
 * The pages' Vite config must load with Vite's native config loader (the
 * default in a future major version): Node itself imports the config, and
 * every relative import it reaches, with no bundler to guess extensions.
 * So each relative import in that graph names its file, `.ts` included.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { expect, test } from 'bun:test';

const CONFIG = resolve(import.meta.dir, '../rounds/web/vite.config.ts');

/** Relative specifiers of static imports and re-exports (`import type` too). */
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"](\.{1,2}\/[^'"]+)['"]/g;

test('the Vite config and what it imports name every relative file', () => {
  const missing: string[] = [];
  const seen = new Set<string>();
  const queue = [CONFIG];
  while (queue.length > 0) {
    const file = queue.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(
      IMPORT,
    )) {
      const target = join(dirname(file), specifier);
      if (!existsSync(target) || !/\.[cm]?[jt]sx?$/.test(target)) {
        missing.push(`${file}: ${specifier}`);
        continue;
      }
      if (/\.[cm]?tsx?$/.test(target)) queue.push(target);
    }
  }
  expect(missing).toEqual([]);
  // The config itself plus what it imports from the project.
  expect(seen.size).toBeGreaterThan(1);
});
