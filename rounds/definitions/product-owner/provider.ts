/**
 * A peça "provider": quem conduz o modelo nesta rodada.
 *
 * Um modelo local no Ollama, dirigido pelo Claude Code. Está isolado aqui para
 * trocar modelo, CLI, contexto ou ferramentas sem tocar no resto da rodada.
 * Outras opções: ClaudeProvider, CodexProvider.
 */

import { OllamaProvider, type AgentProvider } from '../../../src';

export const provider: AgentProvider = new OllamaProvider({
  // O CLI que conduz o modelo: o Claude Code.
  cli: 'claude',
  // O nome do modelo no Ollama (ollama list).
  model: 'qwen3.5:4b',
  // Tokens de contexto que o CLI assume que o modelo tem: perto disso ele
  // compacta o histórico (ollama ps mostra com quanto o modelo subiu).
  contextWindow: 100_000,
  // Desliga o raciocínio do modelo: responde sem pensar antes, com menos
  // tokens e menos tempo por turno. O Goiaba escreve isso em cada pedido ao
  // Ollama, o que depende de uma política (a peça policy).
  think: false,
  // Só a capacidade da tarefa, no vocabulário do Goiaba: escrever um arquivo.
  // O conjunto completo do Claude Code custa uns 15 mil tokens por pedido; o
  // provider traduz file_write para o --tools Write do Claude.
  tools: ['file_write'],
});
