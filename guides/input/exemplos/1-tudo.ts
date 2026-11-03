/**
 * Exemplo 1 do curso de input: tudo o que veio pelo stdin, de uma vez. É o
 * caso de quem recebe um pedido inteiro, como o hook de aprovação recebe o
 * JSON da CLI: `read()` espera o stdin acabar e devolve o texto.
 */
import { read } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const request: unknown = JSON.parse(await read());
const command =
  typeof request === 'object' &&
  request !== null &&
  'tool_input' in request &&
  typeof request.tool_input === 'object' &&
  request.tool_input !== null &&
  'command' in request.tool_input
    ? request.tool_input.command
    : undefined;

writeOut(`a CLI quer rodar: ${String(command)}\n`);
