import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  Agent,
  ClaudeProvider,
  runScript,
  Workspace,
  loadConfig,
  type AgentPermissions,
} from '../src/index.js';

await runScript(async () => {
  const config = await loadConfig();
  const workpace = config.env?.vars.workpace ?? process.cwd();
  mkdirSync(workpace, { recursive: true });
  const hasGit = existsSync(join(workpace, '.git'));
  const hasEnv = existsSync(join(workpace, '.env'));

  // filesystem é aplicado pela sandbox; execution, pelo provider.
  // ignores e deny de filesystem só aceitam caminhos que existem no disco.
  const permissions: AgentPermissions = {
    default: 'deny',
    allow: {
      filesystem: [{
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ...(hasGit ? { ignores: { paths: ['/workspace/.git/**'] } } : {}),
      }],
      execution: [{
        commands: ['bun *', 'npm *'],
        ignores: { commands: ['npm publish*'] },
      }],
    },
    ...(hasEnv
      ? { deny: { filesystem: [{ operations: ['*'], paths: ['/workspace/.env'] }] } }
      : {}),
  };

  const seguro = new Agent({
    prompt: `vamos conversar
    `.trim(),
    provider: new ClaudeProvider({
      model: 'claude-sonnet-5-5',
      // Com permissions.execution o provider usa dontAsk: só roda o que está em allow.
    }),
    workspace: new Workspace({
      type: 'unrestricted',
      // image: 'from oven/bun:latest',
      root: workpace,
      // Caches dos gerenciadores de pacote, para bun/npm install funcionarem.
      // writable: [
      //   join(homedir(), '.bun/install/cache'),
      //   join(homedir(), '.npm'),
      // ],
    }),
    permissions: permissions
  });

  await seguro.run();
});
