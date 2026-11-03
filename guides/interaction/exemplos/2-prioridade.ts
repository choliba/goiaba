/**
 * Exemplo 2 do curso de interaction: o que passa à frente. Uma linha que
 * quem montou diz ser urgente vai antes das que esperam; um comando também,
 * e chega a quem lê como a linha `:nome`. É assim que o Ctrl+A (o comando
 * `approvals`) abre as aprovações no meio de um turno.
 */
import {
  Conversation,
  type InputEvent,
  type InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

function list(events: readonly InputEvent[]): InteractionAdapter {
  return {
    events: async function* () {
      yield* events;
    },
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const conversation = new Conversation(
  list([
    { type: 'message', text: 'primeira' },
    { type: 'message', text: 'segunda' },
    { type: 'message', text: 'pare' },
    { type: 'command', name: 'approvals' },
  ]),
  { urgent: (line) => line === 'pare' },
);

const first = await conversation.listen();
conversation.write(`1: ${first}`);
// Enquanto ninguém pergunta, o resto chega e espera na fila.
await new Promise((resolve) => setTimeout(resolve, 10));
for (let order = 2; order <= 4; order += 1) {
  conversation.write(`${String(order)}: ${await conversation.listen()}`);
}
conversation.close();
