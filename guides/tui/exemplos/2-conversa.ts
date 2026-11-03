/**
 * Exemplo 2 do curso do TUI: uma conversa numa tela de texto. O TuiAdapter
 * desenha numa `TuiScreen` (aqui, uma que guarda o último quadro) e lê as
 * teclas de uma `StdioSource` (aqui, uma lista). A Conversation é a mesma
 * de sempre: o TUI é só mais um adapter.
 */
import type { StdioSource } from '../../../src/adapters/stdio/index';
import { TuiAdapter, type TuiScreen } from '../../../src/adapters/tui/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { writeOut } from '../../../src/output/stdio';

/** Uma tela de 10×36 que guarda o último quadro, sem os estilos. */
function textScreen(): TuiScreen & { readonly lines: () => string[] } {
  let last = '';
  return {
    rows: () => 10,
    columns: () => 36,
    enter: () => undefined,
    leave: () => undefined,
    draw: (text) => {
      if (text.startsWith('\u001b[H')) last = text;
    },
    lines: () =>
      last
        // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split('\r\n')
        .map((line) => line.trimEnd()),
  };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));
const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const screen = textScreen();
const conversation = new Conversation(
  new TuiAdapter({ screen, source: keyboard, frameDelayMs: 0 }),
);

conversation.write('Oi! Em que posso ajudar?');
const asked = conversation.ask('');
keys.publish('quanto é 2 + 2?\r');
await asked;
conversation.status('⏳ pensando…');
conversation.reasoning('uma conta ');
conversation.reasoning('simples');
conversation.stream('Dois mais dois ');
conversation.stream('é quatro.');
conversation.status(undefined);
void conversation.ask('').catch(() => undefined);
keys.publish('obri');
await tick();

for (const line of screen.lines()) writeOut(`|${line}\n`);
conversation.close();
