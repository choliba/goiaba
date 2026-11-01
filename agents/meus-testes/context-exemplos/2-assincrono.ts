/** Exemplo 2 do curso de context: manter o contexto depois de um await. */
import { writeOut } from '../../../src/output/terminal';
import { runAs, currentContext } from '../../../src/context/index';

async function consultar(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  writeOut(`depois do await: ${currentContext().agent}\n`);
}

await runAs({ name: 'relatorio' }, consultar);
