/**
 * Exemplo 1 do curso de filesystem: criar uma pasta, escrever, acrescentar,
 * ler, listar e apagar. Tudo numa pasta temporária, apagada no fim.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  listDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());

// Cria a pasta e as que faltarem no caminho.
ensureDirectory(join(dir, 'notas'));

writeText(join(dir, 'notas', 'hoje.txt'), 'primeira linha\n');
appendText(join(dir, 'notas', 'hoje.txt'), 'segunda linha\n');
writeText(join(dir, 'notas', 'amanha.txt'), 'nada ainda\n');

writeOut(
  `listDirectory: ${JSON.stringify(listDirectory(join(dir, 'notas')).toSorted())}\n`,
);
writeOut(`readText:\n${readText(join(dir, 'notas', 'hoje.txt'))}`);

// Apaga a árvore inteira; um caminho que não existe é ignorado.
removePath(dir);
removePath(dir);
writeOut(`depois de removePath, existe? ${String(pathExists(dir))}\n`);
