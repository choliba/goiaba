import { expect, test } from 'bun:test';

import {
  checkFiles,
  checkLimits,
  matchGlob,
  parseDuration,
  type FileContext,
  type Lookup,
  type Measured,
} from '../src/rounds/criteria';
import type { RoundCriterion } from '../src/rounds/types';

const lookup = (files: Readonly<Record<string, string>>): Lookup => ({
  exists: (name) => Object.hasOwn(files, name),
  read: (name) => (Object.hasOwn(files, name) ? files[name] : undefined),
  list: () => Object.keys(files),
});

const files = (opts: {
  start?: Readonly<Record<string, string>>;
  end?: Readonly<Record<string, string>>;
  changed?: readonly string[];
}): FileContext => ({
  start: lookup(opts.start ?? {}),
  end: lookup(opts.end ?? {}),
  changed: new Set(opts.changed ?? []),
});

const fileVerdicts = (
  criteria: readonly RoundCriterion[],
  ctx: FileContext,
): boolean[] => checkFiles(criteria, ctx).map((result) => result.met);

const limitVerdicts = (
  criteria: readonly RoundCriterion[],
  measured: Measured,
): boolean[] => checkLimits(criteria, measured).map((result) => result.met);

test('file: exists, contains (todos), matches e equals', () => {
  const ctx = files({ end: { 'ticket.md': 'Dado X\nEntão #5f4e4e' } });
  expect(
    fileVerdicts(
      [
        { file: { name: 'ticket.md', exists: true } },
        { file: { name: 'ticket.md', contains: ['Então', '#5f4e4e'] } },
        { file: { name: 'ticket.md', matches: [/#[0-9a-f]{6}/i] } },
        { file: { name: 'ausente.md', exists: false } },
        { file: { name: 'ticket.md', contains: ['não tem'] } },
      ],
      ctx,
    ),
  ).toEqual([true, true, true, true, false]);
});

test('file: created, deleted e changed usam início vs fim', () => {
  const ctx = files({
    start: { 'velho.txt': 'a' },
    end: { 'novo.txt': 'b' },
    changed: ['novo.txt', 'velho.txt'],
  });
  expect(
    fileVerdicts(
      [
        { file: { name: 'novo.txt', created: true } },
        { file: { name: 'velho.txt', deleted: true } },
        { file: { name: 'novo.txt', changed: true } },
        { file: { name: 'novo.txt', deleted: true } }, // foi criado, não apagado
      ],
      ctx,
    ),
  ).toEqual([true, true, true, false]);
});

test('file curinga + ignore: nenhum outro arquivo mudou', () => {
  const unchanged = files({
    end: { 'ticket.md': 'x', 'index.html': 'y' },
    changed: ['ticket.md'],
  });
  const changedToo = files({
    end: { 'ticket.md': 'x', 'index.html': 'y' },
    changed: ['ticket.md', 'index.html'],
  });
  const criterion: RoundCriterion = {
    file: { name: '*', ignore: ['ticket.md'], changed: false },
  };
  expect(fileVerdicts([criterion], unchanged)).toEqual([true]);
  expect(fileVerdicts([criterion], changedToo)).toEqual([false]);
});

test('condicional: if/check quando vale, else quando não', () => {
  const criterion: RoundCriterion = {
    if: { name: 'ticket.md', exists: true },
    check: [{ file: { name: 'ticket.md', changed: true } }],
    else: [{ file: { name: 'ticket.md', created: true } }],
  };
  const existia = files({
    start: { 'ticket.md': 'a' },
    end: { 'ticket.md': 'b' },
    changed: ['ticket.md'],
  });
  expect(fileVerdicts([criterion], existia)).toEqual([true]);
  const naoExistia = files({ end: { 'ticket.md': 'b' } });
  expect(fileVerdicts([criterion], naoExistia)).toEqual([true]);
});

test('limit: tempo, tokens e custo comparados com o medido', () => {
  const limit: RoundCriterion = {
    limit: { time: '20s', tokens: 20_000, cost: '0.05' },
  };
  expect(
    limitVerdicts([limit], { ms: 18_000, tokens: 19_000, cost: 0.04 }),
  ).toEqual([true, true, true]);
  expect(
    limitVerdicts([limit], { ms: 25_000, tokens: 30_000, cost: 0.2 }),
  ).toEqual([false, false, false]);
});

test('parseDuration entende s, min e h', () => {
  expect(parseDuration('20s')).toBe(20_000);
  expect(parseDuration('2min')).toBe(120_000);
  expect(parseDuration('1h')).toBe(3_600_000);
  expect(() => parseDuration('rápido')).toThrow('Duração inválida');
});

test('matchGlob: * não cruza barra, ** cruza', () => {
  expect(matchGlob('src/a.ts', 'src/*.ts')).toBe(true);
  expect(matchGlob('src/x/a.ts', 'src/*.ts')).toBe(false);
  expect(matchGlob('src/x/a.ts', 'src/**')).toBe(true);
  expect(matchGlob('ticket.md', '*')).toBe(true);
});
