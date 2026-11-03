/**
 * Exemplo 3 do curso de input: parar de ler. O `signal` encerra o stream:
 * a leitura para, o stdin é devolvido e o `for await` recebe um AbortError.
 * Aqui, ninguém escreve nada no stdin, e desistimos depois de 100 ms.
 */
import { readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const controller = new AbortController();
setTimeout(() => {
  controller.abort();
}, 100);

try {
  for await (const piece of readStream({ signal: controller.signal })) {
    writeOut(`chegou: ${piece}\n`);
  }
} catch (error) {
  writeOut(`parou: ${error instanceof Error ? error.name : String(error)}\n`);
}
