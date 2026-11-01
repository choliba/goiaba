/**
 * Exemplo 1 do curso de output: o destino padrão, o terminal. `write` vai
 * para o stdout, `error` para o stderr, e cada mensagem vira uma linha.
 *
 *   bun agents/meus-testes/output-exemplos/1-terminal.ts
 *   bun agents/meus-testes/output-exemplos/1-terminal.ts 2>/dev/null   # só o stdout
 */
import { terminalOutput } from '../../../src/output/index';

terminalOutput.write('uma mensagem');
terminalOutput.write('outra, já com quebra de linha\n');
terminalOutput.error?.('um aviso, no stderr');
terminalOutput.write(`largura: ${String(terminalOutput.width?.())}`);
