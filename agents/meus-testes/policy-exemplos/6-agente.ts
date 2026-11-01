/**
 * Exemplo 6 do curso de policy: a mesma política num agente. Precisa do
 * Ollama com o modelo e de um `.env` na raiz (a política o esconde, e só se
 * esconde o que existe). Rode na raiz do repositório.
 */
import { Agent, OllamaProvider, Workspace } from '../../../src/index';
import { currentDirectory } from '../../../src/execute/process';
import type { AgentPolicy } from '../../../src/policy/index';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/.env'] },
      },
    ],
    execution: [{ commands: ['bun *', 'git status', 'git diff *'] }],
    network: [
      {
        operations: ['connect'],
        hosts: ['registry.npmjs.org', '*.github.com'],
      },
    ],
    secrets: [{ operations: ['read'], secrets: ['NODE_ENV'] }],
  },
  requireApproval: {
    execution: [{ commands: ['git commit *', 'rm *'] }],
  },
  deny: {
    execution: [{ commands: ['sudo *', 'rm -rf *'] }],
    network: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
  },
};

const agent = new Agent({
  name: 'assistente',
  prompt: 'rode os testes e corrija o que falhar',
  provider: new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' }),
  workspace: new Workspace({ type: 'bubblewrap', root: currentDirectory() }),
  permissions: policy, // o mesmo objeto que um PolicyEngine leria
  conversation: false,
});

await agent.run();
