/**
 * Exemplo 3 do curso de input: parar de esperar uma linha. Um AbortSignal
 * cancela o `next` (por exemplo, a resposta chegou por outro caminho).
 */
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const input = new StdinReader();
const controller = new AbortController();
setTimeout(() => {
  controller.abort();
}, 300);

try {
  await input.next(controller.signal);
} catch (error) {
  const name = error instanceof Error ? error.name : '?';
  const message = error instanceof Error ? error.message : String(error);
  writeOut(`${name}: ${message}\n`);
} finally {
  input.close();
}
