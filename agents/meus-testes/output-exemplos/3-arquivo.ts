/**
 * Exemplo 3 do curso de output: mandar para um arquivo, e para dois lugares
 * ao mesmo tempo. A mesma função `relatorio` escreve no terminal, num
 * arquivo, ou nos dois, sem mudar nada nela.
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
import { terminalOutput, type Output } from '../../../src/output/index';

/** Cada mensagem vira uma linha do arquivo. */
function fileOutput(path: string): Output {
  return {
    write: (text) => {
      appendText(path, text.endsWith('\n') ? text : `${text}\n`);
    },
    error: (text) => {
      appendText(path, `[erro] ${text}\n`);
    },
  };
}

/** Repete cada mensagem em todas as saídas. */
function both(...outputs: readonly Output[]): Output {
  return {
    write: (text) => {
      for (const output of outputs) output.write(text);
    },
    error: (text) => {
      for (const output of outputs) {
        if (output.error === undefined) output.write(text);
        else output.error(text);
      }
    },
  };
}

function relatorio(output: Output): void {
  output.write('3 arquivos');
  output.error?.('1 arquivo ignorado');
}

const dir = join(goiabaCacheDir(environment()), 'output-exemplo', randomUUID());
ensureDirectory(dir);
const log = join(dir, 'relatorio.txt');

try {
  terminalOutput.write('--- no terminal e no arquivo:');
  relatorio(both(terminalOutput, fileOutput(log)));
  terminalOutput.write('--- o que ficou no arquivo:');
  terminalOutput.write(readText(log));
} finally {
  removePath(dir);
}
