import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  runScript,
  Workspace,
  loadConfig,
  type AgentPermissions,
  OllamaProvider,
} from '../src/index.js';

await runScript(async () => {
  const config = await loadConfig();
  const workpace = config.env?.vars['workpace'] ?? process.cwd();
  mkdirSync(workpace, { recursive: true });
  const hasGit = existsSync(join(workpace, '.git'));
  const hasEnv = existsSync(join(workpace, '.env'));

  // filesystem é aplicado pela sandbox; execution, pelo provider.
  // ignores e deny de filesystem só aceitam caminhos que existem no disco.
  const permissions: AgentPermissions = {
    default: 'deny',
    allow: {
      execution: [
        {
          commands: ['bun *',
            'npm *',
            'npx *',
            'bunx *',
            'mkdir *',
            'ls **',
            'cat **',
            'find **',
            'pwd',],
          ignores: { commands: ['npm publish', 'npm publish *'] },
        },
      ],
      filesystem: [
        {
          operations: ['read', 'write', '*'],
          paths: ['/workspace/**'],
          ...(hasGit ? { ignores: { paths: ['/workspace/.git/**'] } } : {}),
        },
      ],
    },
    ...(hasEnv
      ? {
        deny: {
          filesystem: [{ operations: ['*'], paths: ['/workspace/.env'] }],
        },
      }
      : {}),
  };

  const seguro = new Agent({
    prompt: `vamos conversar
    `.trim(),
    provider: new OllamaProvider({
      // Tanto claude quanto codex traduzem permissions.execution para o
      // mecanismo nativo do CLI selecionado.
      cli: 'codex',
      model: 'qwen3.5:4b',
    }),
    workspace: new Workspace({
      type: 'docker',
      // image: 'from oven/bun:latest',
      image: 'FROM node:16-slim',
      root: workpace,
      // Caches dos gerenciadores de pacote, para bun/ npm install funcionarem.
      writable: [
        join(homedir(), '.bun/install/cache'),
        join(homedir(), '.npm'),
      ],
    }),
    permissions: permissions,
  });

  await seguro.run();
});
