/**
 * Exemplo 3 do curso de execute: parar um programa. Abortar o signal manda
 * SIGTERM (e SIGKILL depois de 2 s), chama `onAbort` e termina o `for await`
 * com o motivo do abort.
 */
import { Executor } from '../../../src/execute/index';
import { writeOut } from '../../../src/output/stdio';

const controller = new AbortController();
setTimeout(() => {
  controller.abort(new Error('Cancelado: demorou demais.'));
}, 500);

const startedAt = performance.now();
try {
  for await (const { chunk } of new Executor().run(
    { executable: 'sleep', arguments: ['30'] },
    {
      signal: controller.signal,
      onAbort: () => {
        writeOut('onAbort: hora de desfazer o que mais estiver de pé\n');
      },
    },
  )) {
    writeOut(chunk);
  }
} catch (error) {
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  const message = error instanceof Error ? error.message : String(error);
  writeOut(`parou em ~${seconds} s: ${message}\n`);
}
