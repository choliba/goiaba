/**
 * Exemplo 1 do curso de config: um goiaba.config.ts e o que `loadConfig`
 * devolve. Cria um projeto temporário, carrega e apaga.
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
import { writeOut } from '../../../src/output/stdio';

const project = join(
  goiabaCacheDir(environment()),
  'config-exemplo',
  randomUUID(),
);
ensureDirectory(project);
writeText(
  join(project, 'goiaba.config.ts'),
  `export default {
  debug: true,
  logger: { dir: 'storage/logs' },
  database: { dir: 'storage/db', name: 'agentes.db' },
  homes: { dir: 'storage/homes' },
};
`,
);

try {
  const config = await loadConfig({ cwd: project });
  writeOut(
    `${JSON.stringify(config, null, 2).replaceAll(project, '<projeto>')}\n`,
  );
} finally {
  removePath(project);
}
