import {
  Agent,
  CursorProvider,
  // CodexProvider,
  // CursorProvider,
  // CodexProvider,
  // ClaudeProvider,
  getConfig,
  // OllamaProvider,
  runScript,
  Workspace,
} from '../src/index';

import type { AgentPolicy } from '../src/index';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    // web: [{
    //   domains: ["*"],
    //   operations: ['search']
    // }],
    network: [
      {
        operations: ['*'],
        hosts: ['*'],
      },
    ],
    filesystem: [
      {
        operations: ['read'],
        paths: [`${getConfig().workspaces.dir}/**`],
      },
    ],
  },
};

await runScript(async () => {
  await new Agent({
    resume: false,
    name: 'analista',
    prompt: 'Pesquise sobre o que é choliba e2e.',
    // provider: new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' }),
    // provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
    // provider: new CodexProvider({ model: 'gpt-5.6-terra' }),
    provider: new CursorProvider({ model: 'auto' }),
    workspace: new Workspace({
      type: 'docker',
      image: 'FROM busybox:latest',
      root: getConfig().workspaces.dir,
      hostState: 'none',
    }),
    policy: policy,
  }).run();
});
