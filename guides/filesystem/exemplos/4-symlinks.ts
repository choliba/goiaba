/**
 * Exemplo 4 do curso de filesystem: links simbólicos. `readLink` diz para
 * onde o link aponta; `realPath` segue todos até o arquivo de verdade. É
 * assim que a política de arquivos descobre um link que escapa do workspace.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  createSymlink,
  ensureDirectory,
  goiabaCacheDir,
  isSymlink,
  join,
  readLink,
  readText,
  realPath,
  relative,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());
const workspace = join(dir, 'workspace');
const outside = join(dir, 'fora');
ensureDirectory(workspace);
ensureDirectory(outside);
writeText(join(outside, 'segredo.txt'), 'não era para estar aqui\n');

// Um link dentro do workspace que aponta para fora dele.
const link = join(workspace, 'atalho.txt');
createSymlink(join(outside, 'segredo.txt'), link);

try {
  const hide = (path: string): string => path.replaceAll(dir, '<tmp>');
  writeOut(`isSymlink(atalho.txt): ${String(isSymlink(link))}\n`);
  writeOut(`readLink(atalho.txt): ${hide(readLink(link))}\n`);
  writeOut(`realPath(atalho.txt): ${hide(realPath(link))}\n`);
  writeOut(`readText(atalho.txt): ${readText(link)}`);

  // Dentro do workspace pelo caminho; fora, pelo arquivo de verdade.
  const escapes = relative(realPath(workspace), realPath(link)).startsWith(
    '..',
  );
  writeOut(`o arquivo de verdade está fora do workspace? ${String(escapes)}\n`);
} finally {
  removePath(dir);
}
