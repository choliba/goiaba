/**
 * Exemplo 1 do curso do TUI: o cálculo da tela. `frame` não desenha nada:
 * recebe as entradas da conversa e o tamanho da tela e devolve as linhas.
 * Quebra por palavras, conta um emoji como duas colunas e mostra só as
 * últimas mensagens que cabem.
 */
import { displayWidth, frame } from '../../../src/adapters/tui/index';
import { writeOut } from '../../../src/output/stdio';

const { lines } = frame(
  [
    { kind: 'text', text: 'Oi! Em que posso ajudar?', open: false },
    { kind: 'user', text: 'quanto é 2 + 2?', open: false },
    { kind: 'reasoning', text: 'uma conta simples', open: false },
    {
      kind: 'text',
      text: 'Dois mais dois é quatro, e a conta é exata.',
      open: false,
    },
  ],
  {
    rows: 9,
    columns: 30,
    status: '⏳ pensando…',
    input: 'obri',
    showReasoning: true,
  },
);

for (const line of lines) writeOut(`|${line}\n`);
writeOut(`\nlargura de "💭 oi": ${String(displayWidth('💭 oi'))} colunas\n`);
