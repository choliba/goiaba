/**
 * Exemplo 1 do curso de interaction: uma conversa sobre um adapter seu. O
 * adapter só precisa entregar eventos e ter uma saída; a Conversation faz o
 * resto: pede, espera, guarda o que chega sem ter sido pedido e entrega na
 * ordem. Aqui os eventos vêm de uma lista, com uma pausa entre eles.
 */
import {
  Conversation,
  type InputEvent,
  type InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function scripted(events: readonly InputEvent[]): InteractionAdapter {
  return {
    events: async function* () {
      for (const event of events) {
        await pause(10);
        yield event;
      }
    },
    // Uma lista não sabe perguntar: o pedido é ignorado.
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const conversation = new Conversation(
  scripted([
    { type: 'message', text: 'oi' },
    { type: 'message', text: 'tudo bem?' },
    { type: 'message', text: 'tchau' },
  ]),
);

conversation.write('Olá! Diga algo.');
const first = await conversation.ask('');
conversation.write(`ouvi: ${first}`);
// As outras chegaram enquanto ninguém perguntava: esperaram na fila.
await pause(50);
conversation.write(`depois: ${await conversation.listen()}`);
conversation.write(`e: ${await conversation.listen()}`);
conversation.close();
