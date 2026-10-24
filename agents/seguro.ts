import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  Agent,
  CodexProvider,
  runScript,
  Workspace,
  loadConfig,
  CursorProvider
} from '../src/index.js';



await runScript(async () => {

  const config = await loadConfig();
  const workpace = config.env?.vars.workpace ?? process.cwd();
  const hasGit = existsSync(join(workpace, '.git'));
  const seguro = new Agent({
    prompt: `Analise o projeto sem acessar os metadados do Git.
    1. e vamos bater um papo
    `.trim(),
    provider: new CursorProvider({
      model: 'Auto',
    }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: workpace,
    }),
    permissions: {
      default: 'deny',
      allow: {
        filesystem: [
          {
            operations: ['read', 'write'],
            paths: [`${workpace}/**`],
            ...(hasGit ? { ignores: { paths: [`${workpace}/.git/**`] } } : {}),
          },
        ],
      },
    },
  });

  await seguro.run();
});
