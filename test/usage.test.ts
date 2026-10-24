import { afterEach, expect, test } from 'bun:test';

import { clearConfigCache } from '../src/config/index.js';
import { runScript, UsageError } from '../src/usage.js';

afterEach(() => {
  clearConfigCache();
});

test('runScript imprime UsageError e não relança', async () => {
  const chunks: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof write;

  try {
    await runScript(async () => {
      throw new UsageError('use docker build');
    });
  } finally {
    process.stdout.write = write;
  }

  expect(chunks.join('')).toBe('use docker build\n');
});

test('runScript relança outros erros', async () => {
  await expect(
    runScript(async () => {
      throw new Error('falha interna');
    }),
  ).rejects.toThrow('falha interna');
});
