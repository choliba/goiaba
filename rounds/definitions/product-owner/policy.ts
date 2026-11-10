/**
 * A peça "policy": o que o agente pode fazer.
 *
 * Nega tudo por padrão e libera só o necessário: ler e escrever no workspace e
 * rodar alguns comandos que só olham. Numa rodada ninguém responde, então o
 * que não está liberado é negado na hora. Ter uma política também é o que liga
 * a fronteira de rede — sem ela, o tráfego do Ollama não é lido e os tokens
 * não são medidos.
 */

import type { AgentPolicy } from '../../../src';

export const policy: AgentPolicy = {
  // Ponto de partida: nega qualquer ação que nenhuma regra abaixo libere.
  default: 'deny',
  allow: {
    // Sistema de arquivos: ler e escrever na árvore do workspace.
    filesystem: [
      {
        // Todas as operações (ler e escrever).
        operations: ['*'],
        // Dentro do sandbox o workspace é /workspace. A escrita vale para a
        // árvore toda ou para uma pasta que já existe, nunca para um arquivo
        // solto.
        paths: ['/workspace/**'],
      },
    ],
    // Comandos: só os que inspecionam, nada que altere o sistema.
    execution: [
      {
        // A única operação de execução; omitida, é assumida. Explícita aqui
        // para a categoria ter a mesma forma das outras.
        operations: ['run'],
        // Os comandos liberados (curinga * para os argumentos).
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
