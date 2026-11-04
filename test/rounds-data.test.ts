import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import { validateRound } from '../src/rounds/validate';

/** The rounds' records, kept in the repository to compare: the pages' source. */
const DIR = join(import.meta.dir, '..', 'rounds', 'data');

/** What a secret looks like, by its shape. */
const SHAPES: readonly (readonly [string, RegExp])[] = [
  ['chave sk-', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['token do GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  [
    'senha ou token atribuído',
    /\b(password|passwd|senha|secret|api[_-]?key|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"'<]{6,}/i,
  ],
  // The user's name is not committed either (AGENTS.md).
  ['caminho com nome de usuário', /\/home\/(?!<)[a-z][a-z0-9_-]*\//],
];

const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));

test('os registros das rodadas não contêm senhas, tokens nem caminhos com usuário', () => {
  // The real credentials of this machine (.env included), compared by value.
  const credentials = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      entry[1].length >= 12 &&
      /KEY|TOKEN|SECRET|PASS|AUTH|CREDENTIAL/i.test(entry[0]),
  );

  const found: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(DIR, file), 'utf8');
    for (const [label, shape] of SHAPES) {
      if (shape.test(text)) found.push(`${file}: ${label}`);
    }
    for (const [name, value] of credentials) {
      // Only the name: the value itself never goes to the output.
      if (text.includes(value)) found.push(`${file}: valor de ${name}`);
    }
  }

  expect(found).toEqual([]);
});

test('todo registro é uma rodada válida, com o nome do seu id', () => {
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const round = validateRound(
      JSON.parse(readFileSync(join(DIR, file), 'utf8')),
      file,
    );
    expect(`${round.id}.json`).toBe(file);
  }
});
