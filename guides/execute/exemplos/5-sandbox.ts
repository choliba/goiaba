/**
 * Exemplo 5 do curso de execute: o mesmo Executor, dentro de uma sandbox.
 * O execute não conhece workspace: quem compõe prepara o comando (o
 * workspace o embrulha na jaula) e passa os ganchos. Precisa do bubblewrap;
 * rode na raiz do repositório.
 */
import { Executor } from '../../../src/execute/index';
import { currentDirectory } from '../../../src/execute/process';
import { writeOut } from '../../../src/output/stdio';
import { Workspace } from '../../../src/workspace/index';

const workspace = new Workspace({
  type: 'bubblewrap',
  root: currentDirectory(),
});
const inner = {
  executable: 'sh',
  arguments: ['-c', 'echo "dentro: $(pwd)"; ls -d /home 2>&1'],
};

try {
  // O workspace embrulha: o programa vira um nsenter que entra na jaula.
  const command = await workspace.prepare(inner);
  writeOut(
    `o que roda de fato: ${command.executable} ${String(command.arguments?.length)} argumentos\n`,
  );

  for await (const { chunk } of new Executor().run(command, {
    onStart: (pid) => workspace.sandbox.started?.(pid),
    onAbort: () => void workspace.close(),
  })) {
    writeOut(chunk.replaceAll(currentDirectory(), '<raiz>'));
  }
} finally {
  await workspace.close();
}
