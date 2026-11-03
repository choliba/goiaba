/**
 * Exemplo 5 do curso de adapters: num terminal de verdade. É a conversa que
 * um agente usa (`agentConversation`): o stdio com o Ctrl+A. Rode num
 * terminal (não num pipe) e digite:
 *
 *   bun guides/adapters/exemplos/5-terminal.ts
 *
 *   1. "q" numa linha vazia: responde na hora, sem Enter (`instant`);
 *   2. "oi" e Enter;
 *   3. Ctrl+A: chega como a linha ":approvals";
 *   4. "s" para a escolha.
 */
import { agentConversation } from '../../../src/agent/agent';

const conversation = agentConversation();

conversation.write('digite q (sem Enter):');
conversation.write(
  `recebeu ${JSON.stringify(await conversation.ask('', undefined, ['q']))}`,
);
conversation.write('digite oi e Enter:');
conversation.write(`recebeu ${JSON.stringify(await conversation.ask(''))}`);
conversation.write('aperte Ctrl+A:');
conversation.write(`recebeu ${JSON.stringify(await conversation.ask(''))}`);
conversation.write('s ou n?');
conversation.write(
  `recebeu ${JSON.stringify(await conversation.choose(['s', 'n']))}`,
);
conversation.close();
