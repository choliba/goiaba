/**
 * Exemplo 4 do curso de input: o que o terminal manda vira teclas. O
 * KeyDecoder não precisa de terminal: é só dar o texto. Ele marca o que foi
 * colado, descarta setas e outras sequências, e aguenta sequências partidas.
 */
import { KeyDecoder } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const ESC = '\u001b';
const show = (label: string, chunks: readonly string[]): void => {
  const decoder = new KeyDecoder();
  const keys = chunks.flatMap((chunk) => decoder.feed(chunk));
  writeOut(
    `${label.padEnd(30)} → ${keys.map(({ key, pasted }) => `${JSON.stringify(key)}${pasted ? '(colado)' : ''}`).join(' ')}\n`,
  );
};

show('digitado: ab + Enter', ['ab\r']);
show('seta para cima no meio', [`a${ESC}[Ab`]);
show('Alt+x', [`${ESC}x`]);
show('colado: a, quebra, b', [`${ESC}[200~a\nb${ESC}[201~`]);
show('a marca de colagem partida', [`${ESC}[2`, `00~xy${ESC}[2`, '01~z']);
show('Ctrl+A', ['\u0001']);
