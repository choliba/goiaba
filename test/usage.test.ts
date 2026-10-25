import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { clearConfigCache } from '../src/config/index.js';
import type { OutputAdapter } from '../src/output/index.js';
import { runScript, UsageError } from '../src/usage.js';
import { readLogRecords } from './support/log-records.js';

let cwd: string;

beforeEach(() => {
  clearConfigCache();
  cwd = mkdtempSync(join(tmpdir(), 'goiaba-usage-'));
  writeFileSync(
    join(cwd, 'goiaba.config.ts'),
    `export default { logDir: 'logs' };\n`,
  );
});

afterEach(() => {
  clearConfigCache();
  rmSync(cwd, { recursive: true, force: true });
});

test('runScript mostra UsageError pelo output, registra e não relança', async () => {
  const written: string[] = [];
  const output: OutputAdapter = {
    ask: () => Promise.resolve(''),
    write: (value) => written.push(value),
  };

  await runScript(() => Promise.reject(new UsageError('use docker build')), {
    output,
    config: { cwd },
  });

  expect(written).toEqual(['use docker build']);
  expect(readLogRecords(join(cwd, 'logs', 'erros'))).toEqual([
    expect.objectContaining({
      level: 'error',
      type: 'error',
      message: 'use docker build',
    }),
  ]);
});

test('runScript registra e relança outros erros', async () => {
  await expect(
    runScript(() => Promise.reject(new Error('falha interna')), {
      config: { cwd },
    }),
  ).rejects.toThrow('falha interna');

  expect(readLogRecords(join(cwd, 'logs', 'erros'))).toEqual([
    expect.objectContaining({ message: 'falha interna' }),
  ]);
});

test('runScript trata o SIGINT repetido do mesmo Ctrl+C como um só', async () => {
  const exit = process.exit.bind(process);
  const exits: unknown[] = [];
  process.exit = (code?: number | string | null): never => {
    exits.push(code);
    throw new Error('process.exit chamado');
  };

  try {
    await runScript(
      async ({ signal }) => {
        // Under `bun run` one Ctrl+C arrives twice: from the terminal and the runner.
        process.emit('SIGINT');
        process.emit('SIGINT');
        expect(signal.aborted).toBe(true);
      },
      { config: { cwd } },
    );
  } finally {
    process.exit = exit;
  }

  expect(exits).toEqual([]);
});
