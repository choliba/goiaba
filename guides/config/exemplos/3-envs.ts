/**
 * Exemplo 3 do curso de config: `envs` e uma config que é uma função. As
 * variáveis do primeiro env entram no ambiente do processo, sem sobrescrever
 * as que já existem; só textos entram.
 */
import { randomUUID } from 'node:crypto';

import { getEnv, loadConfig } from '../../../src/config/index';
import {
  environment,
  setEnvironmentDefault,
} from '../../../src/execute/process';
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
  `// Uma função (pode ser async): roda ao carregar a config.
export default async () => ({
  envs: [
    {
      API_URL: 'https://api.exemplo.com',
      REGION: 'sa-east-1',
      RETRIES: 3,              // número: não vira variável
      TOKEN: undefined,        // ausente: não vira variável
    },
    { API_URL: 'https://outro.exemplo.com' }, // só o primeiro env vale
  ],
});
`,
);

// Já existe no processo antes da config: não é sobrescrita.
setEnvironmentDefault('REGION', 'us-east-1');

try {
  await loadConfig({ cwd: project });
  writeOut(`getEnv().vars: ${JSON.stringify(getEnv().vars)}\n`);
  for (const name of ['API_URL', 'REGION', 'RETRIES', 'TOKEN']) {
    writeOut(`environment().${name} = ${String(environment()[name])}\n`);
  }
} finally {
  removePath(project);
}
