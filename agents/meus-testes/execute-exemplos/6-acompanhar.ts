/**
 * Exemplo 6 do curso de execute: acompanhar várias execuções. O
 * OutputDispatcher guarda uma sequência por execução e entrega todas a quem
 * assina, com o id da execução e de quem a pediu.
 */
import { Executor, OutputDispatcher } from '../../../src/execute/index';
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/terminal';

const dispatcher = new OutputDispatcher<ProgramOutput>();
const executor = new Executor();

// O observador: assina antes e lê em paralelo, sem saber quem roda o quê.
void (async () => {
  for await (const {
    executionId,
    programId,
    value,
  } of dispatcher.subscribe()) {
    writeOut(
      `  [observador] ${executionId} (${programId}): ${value.chunk.trim()}\n`,
    );
  }
})();

/** Roda e publica cada pedaço; quem chamou lê a sequência da sua execução. */
async function run(
  executionId: string,
  programId: string,
  text: string,
): Promise<void> {
  const own = dispatcher.open(executionId, programId);
  void (async () => {
    for await (const chunk of executor.run({
      executable: 'echo',
      arguments: [text],
    })) {
      dispatcher.publish(executionId, programId, chunk);
    }
    dispatcher.close(executionId, programId);
  })();
  for await (const { chunk } of own)
    writeOut(`[${executionId}] ${chunk.trim()}\n`);
}

await run('execucao-1', 'eco', 'primeira');
await run('execucao-2', 'eco', 'segunda');
