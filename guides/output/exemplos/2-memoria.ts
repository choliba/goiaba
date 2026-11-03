/**
 * Exemplo 2 do curso de output: uma saída sua. Um destino só precisa de
 * `write`; o `completeOutput` faz o resto, e num lugar só: os pedaços de um
 * stream viram uma mensagem quando ele acaba, um erro vira uma mensagem, o
 * status é ignorado e a linha tem `DEFAULT_LINE_LENGTH` colunas. Esta saída
 * guarda tudo na memória, como um teste faria.
 */
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

const lines: string[] = [];
const memory = completeOutput({
  write: (text, kind = 'message') => {
    lines.push(`${kind}: ${text}`);
  },
});

/** Quem mostra coisas recebe uma Output: não sabe para onde vão. */
async function relatorio(output: Output): Promise<void> {
  await output.status('⏳ contando…');
  await output.writeStream(['3 ', 'arquivos']);
  await output.write('olhando um por um', 'reasoning');
  await output.status(undefined);
  await output.error('1 arquivo ignorado');
}

await relatorio(memory);
await stdioOutput.write(`o que ficou na memória:\n  ${lines.join('\n  ')}`);
await stdioOutput.write(`colunas: ${String(memory.lineLength())}`);
