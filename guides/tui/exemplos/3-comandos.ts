/**
 * Exemplo 3 do curso do TUI: os comandos e a rolagem ficam no TUI. `/help`,
 * `/thinking` e um comando desconhecido nunca chegam à conversa; a próxima
 * linha que chega é a primeira que não começa com `/`. PageUp rola as
 * mensagens para trás, e o status mostra quantas linhas ficaram abaixo.
 */
import type { StdioSource } from '../../../src/adapters/stdio/index';
import { TuiAdapter, type TuiScreen } from '../../../src/adapters/tui/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { writeOut } from '../../../src/output/stdio';

function textScreen(): TuiScreen & { readonly lines: () => string[] } {
  let last = '';
  return {
    rows: () => 12,
    columns: () => 50,
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
const show = (title: string): void => {
  writeOut(`--- ${title}\n`);
  for (const line of screen.lines()) writeOut(`|${line}\n`);
};
const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const screen = textScreen();
const conversation = new Conversation(
  new TuiAdapter({ screen, source: keyboard, frameDelayMs: 0 }),
);

conversation.reasoning('pensei bastante');
const asked = conversation.ask('');
keys.publish('/thinking\r/xyz\r/help\rolá\r');
writeOut(`a conversa recebeu: ${JSON.stringify(await asked)}\n`);
await tick();
show('depois dos comandos');

keys.publish('\u001b[5~'); // PageUp
await tick();
show('depois do PageUp');
conversation.close();
