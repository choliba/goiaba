/**
 * Exemplo 3 do curso de adapters: o stdio num terminal, sem precisar de
 * um. A fonte (`source`) e o eco (`echo`) são trocáveis: aqui as teclas vêm
 * de uma lista, e o eco, que num terminal iria para a tela, é guardado para
 * mostrar. Digitamos com um erro e o apagar, colamos duas linhas, apertamos
 * Ctrl+A (o comando `approvals`) e respondemos uma escolha com uma tecla.
 */
import {
  StdioAdapter,
  type StdioSource,
} from '../../../src/adapters/stdio/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const echoed: string[] = [];

const conversation = new Conversation(
  new StdioAdapter({
    source: keyboard,
    echo: (text) => echoed.push(text),
    shortcuts: { '\u0001': 'approvals' },
  }),
);

const asked = conversation.ask('');
keys.publish('olx\u007fá\r'); // "olx", apagar, "á", Enter
const first = await asked;

const pasted = conversation.ask('');
keys.publish('\u001b[200~linha um\nlinha dois\u001b[201~\r');
const second = await pasted;

const command = conversation.ask('');
keys.publish('\u0001');
const third = await command;

const choice = conversation.choose(['s', 'n']);
keys.publish('x'); // fora da escolha: espera
keys.publish('S');
const fourth = await choice;
conversation.close();

await stdioOutput.write(`1: ${JSON.stringify(first)}`);
await stdioOutput.write(`2: ${JSON.stringify(second)}`);
await stdioOutput.write(`3: ${JSON.stringify(third)}`);
await stdioOutput.write(`4: ${JSON.stringify(fourth)}`);
await stdioOutput.write(`o eco: ${JSON.stringify(echoed.join(''))}`);
