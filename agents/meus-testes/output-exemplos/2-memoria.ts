/**
 * Exemplo 2 do curso de output: uma saída sua. Uma `Output` é qualquer
 * objeto com `write` (e, se quiser, `error`, `status`, `width`). Esta guarda
 * tudo na memória, como um teste faria para conferir o que foi mostrado.
 */
import { terminalOutput, type Output } from '../../../src/output/index';

/** Guarda cada mensagem, com o tipo dela. */
function memoryOutput(): Output & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (text) => lines.push(`write: ${text}`),
    error: (text) => lines.push(`error: ${text}`),
    status: (text) => lines.push(`status: ${String(text)}`),
  };
}

/** Quem mostra coisas recebe uma Output: não sabe para onde vão. */
function relatorio(output: Output): void {
  output.status?.('⏳ contando…');
  output.write('3 arquivos');
  output.status?.(undefined);
  output.error?.('1 arquivo ignorado');
}

const memory = memoryOutput();
relatorio(memory);
terminalOutput.write(`o que ficou na memória:\n  ${memory.lines.join('\n  ')}`);
