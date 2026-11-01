/**
 * Exemplo 5 do curso de filesystem: o `mode` de pastas e arquivos. Vale só
 * quando o arquivo ou a pasta é criado. O Goiaba usa 0o700 e 0o600 para o
 * que só o dono deve ler (o log, o cache). Para mostrar o mode, o exemplo
 * pergunta ao `stat` (um programa auxiliar, pelo execute).
 */
import { randomUUID } from 'node:crypto';

import { environment, runProgram } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());

const mode = async (path: string): Promise<string> =>
  (await runProgram('stat', ['-c', '%a', path], { timeoutMs: 5000 })).trim();

try {
  ensureDirectory(join(dir, 'privada'), 0o700);
  writeText(join(dir, 'privada', 'log.jsonl'), '{}\n', 0o600);
  writeText(join(dir, 'publico.txt'), 'oi\n');
  // Já existe: o mode passado agora não muda nada.
  appendText(join(dir, 'publico.txt'), 'de novo\n', 0o600);

  writeOut(`privada/          ${await mode(join(dir, 'privada'))}\n`);
  writeOut(
    `privada/log.jsonl ${await mode(join(dir, 'privada', 'log.jsonl'))}\n`,
  );
  writeOut(`publico.txt       ${await mode(join(dir, 'publico.txt'))}\n`);
} finally {
  removePath(dir);
}
