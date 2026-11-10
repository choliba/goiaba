/**
 * A peça "policy": o que um ator pode fazer.
 *
 * Nega tudo por padrão, libera ler e escrever no workspace e rodar os
 * comandos recebidos. Numa rodada ninguém responde, então o que não está
 * liberado é negado na hora. Ter uma política também liga a fronteira de
 * rede: sem ela, os tokens do Ollama não são medidos.
 */

import type { AgentPolicy } from '../../../src';

export const policy = (commands: readonly string[]): AgentPolicy => ({
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['*'],
        // Dentro do sandbox o workspace é /workspace. A escrita vale para a
        // árvore toda ou para uma pasta que já existe, nunca para um arquivo
        // solto.
        paths: ['/workspace/**'],
      },
    ],
    execution: [{ operations: ['run'], commands: [...commands] }],
  },
});
