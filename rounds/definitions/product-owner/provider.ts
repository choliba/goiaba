import {
  OllamaProvider,
  type AgentProvider,
  type OllamaProviderOptions,
} from '../../../src';

/** O provider desta rodada: um modelo local no Ollama, conduzido por um CLI. */
export const ProductOwnerProvider = (
  options: OllamaProviderOptions,
): AgentProvider =>
  new OllamaProvider({
    // O CLI que conduz o modelo: o Claude Code.
    cli: options.cli,
    // O nome do modelo no Ollama (ollama list).
    model: options.model,
    // Quantos tokens de contexto o CLI acha que o modelo tem: perto disso
    // ele compacta o histórico (ollama ps mostra com quanto o modelo subiu).
    contextWindow: options.contextWindow ?? 20000,
    // Desliga o raciocínio do modelo: responde sem pensar antes, com menos
    // tokens e menos tempo por turno. O Goiaba escreve isso em cada pedido
    // ao Ollama, o que precisa de uma política (permissions).
    think: options.think ?? false,
    // As ferramentas que o modelo enxerga (só com cli: claude). O conjunto
    // completo do Claude Code custa uns 15 mil tokens em cada pedido; dar só
    // as da tarefa encolhe isso. undefined = conjunto completo.
    tools: options.tools,
  });
