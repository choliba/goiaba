import type { AgentPolicy } from '../../../src';

/**
 * What the agent may do: read and write the workspace, and run a few
 * commands that only look; anything else is denied without asking (nobody
 * answers in a round). Any policy also gives the agent its network
 * boundary, which is what reads Ollama's traffic: without one, the tokens
 * are not measured.
 */
export const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['*'],
        // Inside the sandbox the workspace is `/workspace` (singular), the
        // only root the policy accepts. Writing is granted to the whole
        // tree or to a folder that already exists, never to a lone file
        // (`index.html` is refused).
        paths: [`/workspace/**`],
      },
    ],
    execution: [
      {
        // A única operação de execução; omitida, é assumida. Explícita aqui
        // para a categoria ter a mesma forma das outras.
        operations: ['run'],
        commands: [
          'ls *',
          'cat *',
          'find *',
          'pwd',
          'git status',
          'git diff *',
          'git log *',
        ],
      },
    ],
  },
};
