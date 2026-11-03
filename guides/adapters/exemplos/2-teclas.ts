/**
 * Exemplo 2 do curso de adapters: o que um terminal manda vira teclas. O
 * KeyDecoder não precisa de terminal: é só dar o texto. Ele marca o que foi
 * colado, separa setas e outras sequências (que nunca viram texto) e aguenta
 * sequências partidas entre dois pedaços.
 */
import { KeyDecoder } from '../../../src/adapters/stdio/index';
import { writeOut } from '../../../src/output/stdio';

const ESC = '\u001b';
const show = (label: string, chunks: readonly string[]): void => {
  const sequences: string[] = [];
  const decoder = new KeyDecoder((sequence) => sequences.push(sequence));
  const keys = chunks.flatMap((chunk) => decoder.feed(chunk));
  const typed = keys
    .map(
      ({ key, pasted }) => `${JSON.stringify(key)}${pasted ? '(colado)' : ''}`,
    )
    .join(' ');
  const other = sequences.map((sequence) => JSON.stringify(sequence)).join(' ');
  writeOut(
    `${label.padEnd(28)} → ${typed}${other === '' ? '' : `  sequências: ${other}`}\n`,
  );
};

show('digitado: ab + Enter', ['ab\r']);
show('seta para cima no meio', [`a${ESC}[Ab`]);
show('Alt+x', [`${ESC}x`]);
show('colado: a, quebra, b', [`${ESC}[200~a\nb${ESC}[201~`]);
show('a marca de colagem partida', [`${ESC}[2`, `00~xy${ESC}[2`, '01~z']);
show('PageUp', [`${ESC}[5~`]);
