/**
 * Exemplo 4 do curso de execute: dar sentido à saída. O Executor entrega
 * pedaços do tamanho que o sistema quiser; quem lê junta até o fim de cada
 * linha antes de interpretar. É o papel de um `parseOutput` de provider.
 */
import { Executor } from '../../../src/execute/index';
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';

/** Linhas inteiras do stdout, por mais partida que a saída chegue. */
async function* lines(
  output: AsyncIterable<ProgramOutput>,
): AsyncIterable<string> {
  let pending = '';
  for await (const { channel, chunk } of output) {
    if (channel !== 'stdout') continue;
    const parts = (pending + chunk).split('\n');
    pending = parts.pop() ?? '';
    yield* parts;
  }
  // O que veio depois do último \n também é uma linha.
  if (pending !== '') yield pending;
}

// Um programa que escreve uma linha em três pedaços, com pausas.
const program = {
  executable: process.execPath,
  arguments: [
    '-e',
    `const write = (text, ms) => new Promise(r => setTimeout(() => { process.stdout.write(text); r(); }, ms));
     await write('pri', 50); await write('meira\\nsegu', 50); await write('nda', 50);`,
  ],
};

let chunks = 0;
const counted = async function* (output: AsyncIterable<ProgramOutput>) {
  for await (const value of output) {
    chunks += 1;
    yield value;
  }
};

for await (const line of lines(counted(new Executor().run(program)))) {
  writeOut(`linha: ${JSON.stringify(line)}\n`);
}
writeOut(`(chegaram ${String(chunks)} pedaços)\n`);
