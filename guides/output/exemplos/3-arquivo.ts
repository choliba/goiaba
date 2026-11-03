/**
 * Exemplo 3 do curso de output: mandar para um arquivo, e para dois lugares
 * ao mesmo tempo. A mesma função `relatorio` escreve no stdio, num arquivo,
 * ou nos dois, sem mudar nada nela.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
} from '../../../src/filesystem/index';
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

/** Cada mensagem vira uma linha do arquivo. */
function fileOutput(path: string): Output {
  return completeOutput({
    write: (text) => {
      appendText(path, text.endsWith('\n') ? text : `${text}\n`);
    },
    error: (text) => {
      appendText(path, `[erro] ${text}\n`);
    },
  });
}

/** Repete cada mensagem em todas as saídas. */
function both(...outputs: readonly Output[]): Output {
  return completeOutput({
    write: async (text, kind) => {
      for (const output of outputs) await output.write(text, kind);
    },
    error: async (text) => {
      for (const output of outputs) await output.error(text);
    },
  });
}

async function relatorio(output: Output): Promise<void> {
  await output.write('3 arquivos');
  await output.error('1 arquivo ignorado');
}

const dir = join(goiabaCacheDir(environment()), 'output-exemplo', randomUUID());
ensureDirectory(dir);
const log = join(dir, 'relatorio.txt');

try {
  await stdioOutput.write('--- no stdio e no arquivo:');
  await relatorio(both(stdioOutput, fileOutput(log)));
  await stdioOutput.write('--- o que ficou no arquivo:');
  await stdioOutput.write(readText(log));
} finally {
  removePath(dir);
}
