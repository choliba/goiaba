import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { WorkspaceLock } from '../src/agent/lock';
import { UsageError } from '../src/errors';

let cache: string;
let previous: string | undefined;

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'goiaba-lock-'));
  previous = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
});

afterEach(() => {
  if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = previous;
  rmSync(cache, { recursive: true, force: true });
});

function startNew(): void {
  new WorkspaceLock('/w', 'novo').acquire();
}

/** The lock of `root` as another program would have left it. */
function lockOf(root: string, owner: Record<string, unknown>): void {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
  const dir = join(cache, 'goiaba', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(owner));
}

test('outro programa vivo no workspace impede de iniciar', () => {
  const other = spawn('sleep', ['30']);

  try {
    lockOf('/w', {
      pid: other.pid,
      command: 'sleep',
      agent: 'assistente',
      startedAt: '2026-10-26T16:13:01.000Z',
    });

    expect(startNew).toThrow(UsageError);
    expect(startNew).toThrow(
      `Já existe um agente rodando neste workspace: assistente (pid ${String(other.pid)}, desde 16:13 UTC)`,
    );
  } finally {
    other.kill();
  }
});

test('trava de um programa que morreu é assumida', () => {
  lockOf('/w', {
    pid: 2_147_483_000,
    command: 'bun',
    agent: 'antigo',
    startedAt: '2026-10-26T16:13:01.000Z',
  });

  expect(() => new WorkspaceLock('/w', 'novo').acquire()).not.toThrow();
});

test('pid reaproveitado por outro programa não conta como dono', () => {
  const other = spawn('sleep', ['30']);

  try {
    lockOf('/w', {
      pid: other.pid,
      command: 'bun',
      agent: 'antigo',
      startedAt: '2026-10-26T16:13:01.000Z',
    });

    expect(() => new WorkspaceLock('/w', 'novo').acquire()).not.toThrow();
  } finally {
    other.kill();
  }
});

test('liberada, outro agente pode iniciar; no mesmo programa não bloqueia', () => {
  const first = new WorkspaceLock('/w', 'primeiro');
  first.acquire();

  // Same program: agents share the workspace.
  expect(() => new WorkspaceLock('/w', 'segundo').acquire()).not.toThrow();

  first.release();
  expect(() => new WorkspaceLock('/w', 'terceiro').acquire()).not.toThrow();
});

test('workspaces diferentes não se bloqueiam', () => {
  const other = spawn('sleep', ['30']);

  try {
    lockOf('/a', {
      pid: other.pid,
      command: 'sleep',
      agent: 'a',
      startedAt: '2026-10-26T16:13:01.000Z',
    });

    expect(() => new WorkspaceLock('/b', 'b').acquire()).not.toThrow();
  } finally {
    other.kill();
  }
});
