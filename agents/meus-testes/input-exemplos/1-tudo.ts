/**
 * Exemplo 1 do curso de input: tudo o que chegou pelo stdin, de uma vez. É
 * como um hook recebe o pedido da CLI. Rode com algo canalizado:
 *
 *   printf '{"tool":"Bash","command":"ls"}' | bun agents/meus-testes/input-exemplos/1-tudo.ts
 */
import { readAllInput } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const request: unknown = JSON.parse(readAllInput());
writeOut(`recebido: ${JSON.stringify(request)}\n`);
