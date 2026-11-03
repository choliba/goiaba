/**
 * Exemplo 1 do curso de output: o stdio. `stdioOutput` manda as mensagens
 * para o stdout e os erros para o stderr. Os modos se esperam com `await`:
 * uma mensagem inteira (`write`) ou os pedaços dela (`writeStream`), de um
 * array ou de um gerador assíncrono. O raciocínio vai numa linha própria,
 * depois de 💭.
 */
import { stdioOutput } from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function* resposta(): AsyncGenerator<string> {
  for (const piece of ['Três ', 'arquivos ', 'mudaram.\n']) {
    await pause(50);
    yield piece;
  }
}

await stdioOutput.write('uma mensagem é uma linha');
await stdioOutput.writeStream(['pedaços ', 'de um ', 'array\n']);
await stdioOutput.writeStream(['pensando ', 'no que mudou'], 'reasoning');
await stdioOutput.writeStream(resposta());
await stdioOutput.error('isto vai para o stderr');
await stdioOutput.write(
  `uma linha aqui tem ${String(stdioOutput.lineLength())} colunas`,
);
