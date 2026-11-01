/**
 * Exemplo 2 do curso de execute: quando o programa falha. Código diferente
 * de zero vira ProgramExecutionError, depois da saída que o programa deu; um
 * programa que não existe, o erro do sistema.
 */
import { Executor, ProgramExecutionError } from '../../../src/execute/index';
import type { ProgramCommand } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/terminal';

const executor = new Executor();
const commands: readonly ProgramCommand[] = [
  { executable: 'ls', arguments: ['package.json'] },
  { executable: 'ls', arguments: ['nao-existe'] },
  { executable: 'programa-que-nao-existe' },
];

for (const command of commands) {
  writeOut(`${[command.executable, ...(command.arguments ?? [])].join(' ')}\n`);
  try {
    for await (const { channel, chunk } of executor.run(command)) {
      writeOut(`  ${channel}: ${chunk.trim()}\n`);
    }
    writeOut('  terminou bem\n');
  } catch (error) {
    const kind =
      error instanceof ProgramExecutionError
        ? `ProgramExecutionError (code ${String(error.code)})`
        : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    writeOut(`  ${kind}: ${message}\n`);
  }
}
