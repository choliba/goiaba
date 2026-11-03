/**
 * Exemplo 1 do curso de execute: rodar um programa. Só o Executor e um
 * ProgramCommand: sem sandbox, sem provider. A saída chega em pedaços, com
 * o canal (stdout ou stderr) de cada um.
 */
import { Executor } from '../../../src/execute/index';
import { writeOut } from '../../../src/output/stdio';

const executor = new Executor();

for await (const { channel, chunk } of executor.run({
  executable: 'printf',
  arguments: ['%s\n', 'olá', 'tudo certo'],
})) {
  writeOut(`${channel}: ${JSON.stringify(chunk)}\n`);
}

// Com entrada: `input` vai para o stdin do programa.
for await (const { chunk } of executor.run({
  executable: 'tr',
  arguments: ['a-z', 'A-Z'],
  input: 'gritando',
})) {
  writeOut(`tr: ${chunk}\n`);
}
