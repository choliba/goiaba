/**
 * Exemplo 3 do curso de cli: aprovar um pedido. O exemplo grava no banco de
 * um projeto temporário dois pedidos negados (como o gate faria), roda o
 * comando respondendo pelo stdin (`1`, `r`, `w`: marca o primeiro, avança,
 * aprova para o workspace) e mostra o que ficou no banco.
 *
 *   bun agents/meus-testes/cli-exemplos/3-aprovar.ts
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
import { Store } from '../../../src/store/index';

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
const databasePath = join(project, 'db', 'goiaba.db');
const workspace = '/projeto/app';

// O que o gate grava quando o `default` nega: um pedido pendente.
const store = Store.open(databasePath);
for (const command of ['npm install left-pad', 'curl https://exemplo.com']) {
  store.recordDecision({
    session: 'sessao-1',
    provider: 'claude',
    root: workspace,
    command,
    decision: 'deny',
    source: 'default',
    reason: 'Nenhuma regra corresponde à ação.',
  });
}
store.close();

try {
  // Sem terminal, a tela lê uma linha por resposta.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [approvals, '--root', workspace],
    cwd: project,
    input: '1\nr\nw\n',
  })) {
    terminalOutput.write(
      chunk.trimEnd().replaceAll(/\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<horário>'),
    );
  }

  const after = Store.open(databasePath);
  terminalOutput.write('\n--- no banco, depois:');
  for (const approval of after.activeApprovals(workspace)) {
    terminalOutput.write(`aprovação: ${approval.kind} "${approval.pattern}"`);
  }
  for (const pending of after.deniedDecisions(workspace)) {
    terminalOutput.write(`ainda pendente: ${pending.command}`);
  }
  after.close();
} finally {
  removePath(project);
}
