/**
 * Exemplo 2 do curso de filesystem: perguntar sobre um caminho. Cuidado:
 * `isDirectory`, `isSymlink` e `modifiedAt` lançam se o caminho não existe;
 * `pathExists` e `canOpen` nunca lançam.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  canOpen,
  ensureDirectory,
  goiabaCacheDir,
  isDirectory,
  isSymlink,
  join,
  modifiedAt,
  pathExists,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());
ensureDirectory(dir);
const file = join(dir, 'arquivo.txt');
writeText(file, 'x');
const missing = join(dir, 'nao-existe');

try {
  writeOut(`pathExists(arquivo): ${String(pathExists(file))}\n`);
  writeOut(`isDirectory(pasta): ${String(isDirectory(dir))}\n`);
  writeOut(`isDirectory(arquivo): ${String(isDirectory(file))}\n`);
  writeOut(`isSymlink(arquivo): ${String(isSymlink(file))}\n`);
  writeOut(
    `modifiedAt(arquivo) é recente: ${String(Date.now() - modifiedAt(file) < 60_000)}\n`,
  );
  writeOut(`canOpen(arquivo): ${String(canOpen(file))}\n`);
  writeOut(`canOpen('/etc/shadow'): ${String(canOpen('/etc/shadow'))}\n`);

  writeOut(`pathExists(nao-existe): ${String(pathExists(missing))}\n`);
  try {
    isDirectory(missing);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? String(error.code) : '?';
    writeOut(`isDirectory(nao-existe): lança ${code}\n`);
  }
  // O jeito seguro: perguntar se existe antes.
  writeOut(
    `pathExists && isDirectory: ${String(pathExists(missing) && isDirectory(missing))}\n`,
  );
} finally {
  removePath(dir);
}
