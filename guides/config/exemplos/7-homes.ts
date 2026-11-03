/** Exemplo 7 do curso de config: escolher onde os homes dos workspaces ficam. */
import { randomUUID } from 'node:crypto';

import { loadConfig } from '../../../src/config/index';
import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
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
  `export default { homes: { dir: 'storage/homes' } };\n`,
);

try {
  const config = await loadConfig({ cwd: project });
  writeOut(`homes.dir: ${config.homes.dir.replaceAll(project, '<projeto>')}\n`);
} finally {
  removePath(project);
}
