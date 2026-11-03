/**
 * Exemplo 4 do curso de interaction: pedidos que ninguém responde. Cada
 * pedido que o adapter não pode fazer é logado; passado o limite, sem nada
 * chegar no meio, perguntar de novo é um UsageError, em vez de esperar
 * para sempre. O limite padrão é DEFAULT_MAX_UNANSWERED_REQUESTS.
 */
import { UsageError } from '../../../src/errors';
import { OutputStream } from '../../../src/execute/stream';
import {
  Conversation,
  DEFAULT_MAX_UNANSWERED_REQUESTS,
  type InputEvent,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const conversation = new Conversation(
  {
    // Nada chega (o stream nunca acaba), e o adapter não sabe perguntar.
    events: () => new OutputStream<InputEvent>(),
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  },
  { maxUnansweredRequests: 2 },
);

conversation.write(
  `padrão: ${String(DEFAULT_MAX_UNANSWERED_REQUESTS)}; aqui: 2`,
);
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort();
  }, 10);
  try {
    await conversation.ask('', controller.signal);
  } catch (error) {
    const kind = error instanceof UsageError ? 'UsageError' : 'desistiu';
    conversation.write(
      `tentativa ${String(attempt)}: ${kind}${error instanceof UsageError ? ` (${error.message})` : ''}`,
    );
  }
}
conversation.close();
