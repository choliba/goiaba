/**
 * Exemplo 3 do curso de interaction: escolher e desistir. Um adapter que só
 * tem linhas responde uma escolha com a primeira letra da linha, e a
 * Conversation mostra a resposta. Desistir de uma pergunta (o signal) não
 * perde o que chegar depois: a linha fica para quem perguntar em seguida.
 */
import { OutputStream } from '../../../src/execute/stream';
import { Conversation, type InputEvent } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const incoming = new OutputStream<InputEvent>();
const conversation = new Conversation({
  events: () => incoming,
  request: () => undefined,
  output: stdioOutput,
  close: () => {
    incoming.close();
  },
});

conversation.write('Continuar? [s/n]');
const choice = conversation.choose(['s', 'n']);
incoming.publish({ type: 'message', text: 'Sim, pode' });
conversation.write(`escolheu: ${await choice}`);

const controller = new AbortController();
const asked = conversation.ask('', controller.signal);
controller.abort();
try {
  await asked;
} catch (error) {
  conversation.write(
    `a pergunta: ${error instanceof Error ? error.message : String(error)}`,
  );
}
incoming.publish({ type: 'message', text: 'chegou depois' });
conversation.write(`a próxima: ${await conversation.listen()}`);
conversation.close();
