import { expect, test } from 'bun:test';

import { KeyDecoder } from '../src/input/index';

const typed = (keys: string): { key: string; pasted: boolean }[] =>
  Array.from(keys, (key) => ({ key, pasted: false }));

test('teclas digitadas passam como estão', () => {
  expect(new KeyDecoder().feed('ab\r')).toEqual(typed('ab\r'));
});

test('texto colado vem marcado, com as quebras de linha como texto', () => {
  const keys = new KeyDecoder().feed('\u001b[200~a\nb\u001b[201~\r');

  expect(keys).toEqual([
    { key: 'a', pasted: true },
    { key: '\n', pasted: true },
    { key: 'b', pasted: true },
    { key: '\r', pasted: false },
  ]);
});

test('as marcas de colagem podem chegar partidas entre pedaços', () => {
  const decoder = new KeyDecoder();

  expect(decoder.feed('\u001b[20')).toEqual([]);
  expect(decoder.feed('0~x\u001b')).toEqual([{ key: 'x', pasted: true }]);
  expect(decoder.feed('[201~y')).toEqual([{ key: 'y', pasted: false }]);
});

test('setas e outras sequências não viram texto', () => {
  expect(new KeyDecoder().feed('a\u001b[Ab\u001b[1;5Cc')).toEqual(typed('abc'));
});

test('Esc sozinho ou Alt+tecla não engolem a tecla', () => {
  expect(new KeyDecoder().feed('\u001bx')).toEqual(typed('x'));
});

test('Ctrl+A continua uma tecla, fora de uma colagem', () => {
  expect(new KeyDecoder().feed('\u0001')).toEqual(typed('\u0001'));
});
