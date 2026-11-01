/**
 * Exemplo 5 do curso de config: GOIABA_DEBUG e GOIABA_LOG_DIR valem mais que
 * o arquivo, sem editá-lo. Rode de três jeitos:
 *
 *   bun agents/meus-testes/config-exemplos/5-variaveis.ts
 *   GOIABA_DEBUG=0 bun agents/meus-testes/config-exemplos/5-variaveis.ts
 *   GOIABA_LOG_DIR=/tmp/meus-logs bun agents/meus-testes/config-exemplos/5-variaveis.ts
 */
import { randomUUID } from 'node:crypto';

import { loadConfig } from '../../../src/config/index';
import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  join,
  removePath,
  writeText,
  goiabaCacheDir,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const project = join(
  goiabaCacheDir(environment()),
  'config-exemplo',
  randomUUID(),
);
ensureDirectory(project);
writeText(
  join(project, 'goiaba.config.ts'),
  `export default { debug: true, logger: { dir: 'logs' } };\n`,
);

try {
  const { debug, logger } = await loadConfig({ cwd: project });
  writeOut(
    `debug: ${String(debug)}, logger.dir: ${logger.dir.replaceAll(project, '<projeto>')}\n`,
  );
} finally {
  removePath(project);
}
