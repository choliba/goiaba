/**
 * Exemplo 2 do curso de cli: sem nada para aprovar. O comando lê o banco do
 * projeto onde roda (o `database` do goiaba.config.ts); um projeto novo não
 * tem pedidos. Cria um projeto temporário, roda o comando nele e apaga.
 *
 *   bun agents/meus-testes/cli-exemplos/2-sem-pedidos.ts
 */
import { randomUUID } from 'node:crypto';

import { Executor } from '../../../src/execute/index';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { terminalOutput } from '../../../src/output/index';

const approvals = new URL('../../../src/cli/approvals.ts', import.meta.url)
  .pathname;
const project = join(
  goiabaCacheDir(environment()),
  'cli-exemplo',
  randomUUID(),
);
ensureDirectory(project);
writeText(
  join(project, 'goiaba.config.ts'),
  `export default { database: { dir: 'db' } };\n`,
);

try {
  // O comando roda dentro do projeto: é de lá que ele lê a config e o banco.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [approvals],
    cwd: project,
  })) {
    terminalOutput.write(chunk.trimEnd());
  }
} finally {
  removePath(project);
}
