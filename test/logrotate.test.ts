import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { afterEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, log, openLogger } from '../src/logger/index';
import { partSession, pruneLogs } from '../src/logger/rotate';
import { parseSize } from '../src/logger/size';

const DAY = 24 * 60 * 60 * 1000;

/** A project folder with this goiaba.config.ts body. */
function project(config: string): string {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-logrotate-'));
  writeFileSync(join(cwd, 'goiaba.config.ts'), `export default ${config};\n`);
  return cwd;
}

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

describe('logrotate: uma sessão longa continua no arquivo seguinte', () => {
  test('cada parte passa do limite no máximo por um registro', async () => {
    // ~1 KB per file: a handful of records each.
    const cwd = project(
      "{ logger: { dir: 'logs', logrotate: { maxFileSize: '1kb' } } }",
    );
    try {
      await loadConfig({ cwd });
      openLogger();
      for (let i = 0; i < 40; i += 1) {
        log.info({
          type: 'message',
          value: `registro ${String(i)} ${'x'.repeat(40)}`,
        });
      }
      const dir = join(cwd, 'logs');
      // While open, the session says its process is writing it…
      expect(
        readdirSync(dir).filter((file) => file.endsWith('.pid')),
      ).toHaveLength(1);
      closeLogger();
      // …and, closed, it does not any more.
      expect(readdirSync(dir).filter((file) => file.endsWith('.pid'))).toEqual(
        [],
      );

      const files = readdirSync(dir).toSorted();
      expect(files.length).toBeGreaterThan(2);
      // The first part has no number: `<sessão>.jsonl`.
      const first = files.find((file) => file.endsWith('Z.jsonl')) ?? '';
      const session = first.replace(/\.jsonl$/, '');
      expect(files).toContain(`${partSession(session, 2)}.jsonl`);
      const lines = files.flatMap((file) =>
        readFileSync(join(dir, file), 'utf8').trim().split('\n'),
      );
      // Nothing lost, nothing cut: every record is a whole JSON line.
      expect(lines).toHaveLength(40);
      for (const line of lines)
        expect(() => JSON.parse(line) as unknown).not.toThrow();
      // In bytes, as the file is: accents take more than one.
      const longest = Math.max(
        ...lines.map((line) => Buffer.byteLength(`${line}\n`)),
      );
      for (const file of files) {
        expect(statSync(join(dir, file)).size).toBeLessThan(1024 + longest);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('logrotate com o logger.use (pino)', () => {
  test('o pino também passa para o arquivo seguinte, sem perder registro', async () => {
    // Inside the repo, so the config's `import 'pino'` resolves.
    const cwd = mkdtempSync(join(import.meta.dir, 'tmp-logrotate-'));
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `import { join } from 'node:path';
import pino from 'pino';
export default {
  logger: {
    dir: 'logs',
    use: ({ dir, session }) =>
      pino({ level: 'debug' }, pino.destination({ dest: join(dir, session + '.jsonl'), sync: true, mkdir: true })),
    logrotate: { maxFileSize: '1kb' },
  },
};
`,
    );
    try {
      await loadConfig({ cwd });
      openLogger();
      for (let i = 0; i < 30; i += 1) {
        log.info({
          type: 'message',
          value: `registro ${String(i)} ${'x'.repeat(40)}`,
        });
      }
      closeLogger();
      const dir = join(cwd, 'logs');
      const files = readdirSync(dir);
      expect(files.length).toBeGreaterThan(2);
      const lines = files.flatMap((file) =>
        readFileSync(join(dir, file), 'utf8').trim().split('\n'),
      );
      expect(lines).toHaveLength(30);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/** A session's files, last changed `age` ms ago. */
function writeSession(
  dir: string,
  name: string,
  age: number,
  bytes = 10,
  parts = 1,
): void {
  const when = (Date.now() - age) / 1000;
  for (let part = 1; part <= parts; part += 1) {
    const file = join(dir, `${partSession(name, part)}.jsonl`);
    writeFileSync(file, `${'x'.repeat(bytes - 1)}\n`);
    utimesSync(file, when, when);
  }
}

describe('pruneLogs', () => {
  const rotation = {
    maxFileBytes: 20 * 1024 * 1024,
    days: 14,
    maxTotalBytes: 200 * 1024 * 1024,
    compress: false,
  };

  test('apaga as sessões velhas inteiras e guarda a atual e as de processos vivos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goiaba-prune-'));
    try {
      writeSession(dir, '2026-01-01T00-00-00.000Z', 30 * DAY, 10, 3);
      writeSession(dir, '2026-02-01T00-00-00.000Z', 20 * DAY);
      writeSession(dir, 'atual', 30 * DAY);
      // Idle for 30 days, but its process (this test) is alive.
      writeSession(dir, 'viva', 30 * DAY);
      writeFileSync(join(dir, 'viva.pid'), String(process.pid));
      // Its process is gone: the mark is stale, the session is over.
      writeSession(dir, 'caiu', 30 * DAY);
      writeFileSync(join(dir, 'caiu.pid'), '999999999');
      writeSession(dir, 'recente', 2 * DAY);
      writeFileSync(join(dir, 'anotacao.txt'), 'não é log');

      const result = pruneLogs(dir, rotation, 'atual');

      expect(result.deleted.toSorted()).toEqual([
        '2026-01-01T00-00-00.000Z',
        '2026-02-01T00-00-00.000Z',
        'caiu',
      ]);
      expect(readdirSync(dir).toSorted()).toEqual([
        'anotacao.txt',
        'atual.jsonl',
        'recente.jsonl',
        'viva.jsonl',
        'viva.pid',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('com a pasta grande demais, apaga das mais antigas até caber', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goiaba-prune-'));
    try {
      const kb = 1024;
      writeSession(dir, 'a', 5 * DAY, 400 * kb);
      writeSession(dir, 'b', 4 * DAY, 400 * kb);
      writeSession(dir, 'c', 3 * DAY, 400 * kb);
      // 1 MB at most: a and b go, c stays.
      const result = pruneLogs(
        dir,
        { ...rotation, maxTotalBytes: 1024 * 1024 },
        'x',
      );
      expect(result.deleted).toEqual(['a']);
      expect(readdirSync(dir).toSorted()).toEqual(['b.jsonl', 'c.jsonl']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('com compress, as sessões encerradas viram .jsonl.gz legíveis', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goiaba-prune-'));
    try {
      mkdirSync(dir, { recursive: true });
      writeSession(dir, 'antiga', 2 * DAY, 30);
      writeSession(dir, 'viva', 60 * 1000, 30);
      writeFileSync(join(dir, 'viva.pid'), String(process.pid));
      // Touched a minute ago, but nobody is writing it: it is over.
      writeSession(dir, 'parada', 60 * 1000, 30);
      const result = pruneLogs(dir, { ...rotation, compress: true }, 'x');
      expect(result.compressed.toSorted()).toEqual([
        join(dir, 'antiga.jsonl'),
        join(dir, 'parada.jsonl'),
      ]);
      expect(readdirSync(dir).toSorted()).toEqual([
        'antiga.jsonl.gz',
        'parada.jsonl.gz',
        'viva.jsonl',
        'viva.pid',
      ]);
      const text = gunzipSync(
        readFileSync(join(dir, 'antiga.jsonl.gz')),
      ).toString();
      expect(text).toBe(`${'x'.repeat(29)}\n`);
      // The compressed file keeps the session's age: still two days old.
      const age = Date.now() - statSync(join(dir, 'antiga.jsonl.gz')).mtimeMs;
      expect(age).toBeGreaterThan(DAY);
      // So the next prune, with one day, deletes it.
      const next = pruneLogs(
        dir,
        { ...rotation, days: 1, compress: true },
        'x',
      );
      expect(next.deleted).toEqual(['antiga']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('logger.logrotate no goiaba.config.ts', () => {
  test('preenche o que não foi dito com os padrões', async () => {
    const cwd = project('{ logger: { logrotate: { days: 7 } } }');
    try {
      const config = await loadConfig({ cwd });
      expect(config.logger.logrotate).toEqual({
        maxFileBytes: 20 * 1024 * 1024,
        days: 7,
        maxTotalBytes: 200 * 1024 * 1024,
        compress: false,
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test.each([
    ['{ logger: { rotacao: true } }', 'Opção desconhecida "logger.rotacao"'],
    [
      '{ logger: { logrotate: { dias: 7 } } }',
      'Opção desconhecida "logger.logrotate.dias"',
    ],
    ['{ logger: { logrotate: { days: 0 } } }', 'logger.logrotate.days'],
    [
      '{ logger: { logrotate: { maxFileSize: 20 } } }',
      'logger.logrotate.maxFileSize em',
    ],
    [
      "{ logger: { logrotate: { maxTotalSize: '20 metros' } } }",
      'deve ser um tamanho com a unidade',
    ],
    [
      "{ logger: { logrotate: { size: '20m' } } }",
      'Opção desconhecida "logger.logrotate.size"',
    ],
    [
      "{ logger: { logrotate: { compress: 'sim' } } }",
      'logger.logrotate.compress',
    ],
  ])('recusa %s', async (config, message) => {
    const cwd = project(config);
    try {
      await expect(loadConfig({ cwd })).rejects.toThrow(message);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('parseSize', () => {
  test.each([
    ['500k', 500 * 1024],
    ['1024kb', 1024 * 1024],
    ['10m', 10 * 1024 ** 2],
    ['20mb', 20 * 1024 ** 2],
    ['50M', 50 * 1024 ** 2],
    ['1g', 1024 ** 3],
    ['2gb', 2 * 1024 ** 3],
    ['1.5mb', 1.5 * 1024 ** 2],
    [' 100 KB ', 100 * 1024],
  ])('%s', (text, bytes) => {
    expect(parseSize(text)).toBe(bytes);
  });

  test.each(['20', '20x', '-1mb', '0kb', 'mb', ''])('recusa %p', (text) => {
    expect(parseSize(text)).toBeUndefined();
  });
});
