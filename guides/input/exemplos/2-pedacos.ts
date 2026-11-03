/**
 * Exemplo 2 do curso de input: o stdin em pedaços, conforme chegam. Quem
 * decide o tamanho de cada pedaço é o sistema, não o conteúdo: um pedaço
 * pode ter várias linhas, ou o fim de uma e o começo de outra.
 */
import { readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

let count = 0;
for await (const piece of readStream()) {
  count += 1;
  writeOut(`pedaço ${String(count)}: ${JSON.stringify(piece)}\n`);
}
writeOut(`o stdin acabou depois de ${String(count)} pedaço(s)\n`);
