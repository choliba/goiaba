/**
 * Exemplo 1 do curso de adapters: o stdio num pipe. Cada linha que chega é
 * uma mensagem; nada pode ser pedido (um pipe não tem teclas nem prompt),
 * então os pedidos são ignorados e o que chega responde. A saída é o stdio.
 */
import { StdioAdapter } from '../../../src/adapters/stdio/index';
import { Conversation } from '../../../src/interaction/index';

const conversation = new Conversation(new StdioAdapter());

for (;;) {
  let line: string;
  try {
    line = await conversation.ask('');
  } catch {
    break; // o stdin acabou
  }
  conversation.write(`ouvi: ${line}`);
}
conversation.write('fim da entrada');
conversation.close();
