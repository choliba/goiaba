/**
 * A peça "provider": quem conduz o modelo de um ator.
 *
 * Um modelo local no Ollama, dirigido pelo Claude Code. Cada chamada cria um
 * provider novo: cada ator tem o seu, e dá para dar um modelo diferente a
 * cada um no definition.ts.
 */

import { OllamaProvider, type AgentProvider } from '../../../src';

export interface ProviderParams {
  /** O nome do modelo no Ollama (ollama list). */
  readonly model: string;
  /**
   * Tokens de contexto que o CLI assume que o modelo tem: perto disso ele
   * compacta o histórico (ollama ps mostra com quanto o modelo subiu).
   */
  readonly contextWindow: number;
  /** Raciocinar antes de responder; desligado, gasta menos tokens e tempo. */
  readonly think?: boolean;
}

export const provider = ({
  model,
  contextWindow,
  think = false,
}: ProviderParams): AgentProvider =>
  new OllamaProvider({
    // O CLI que conduz o modelo: o Claude Code.
    cli: 'claude',
    model,
    contextWindow,
    think,
    // Só o que o fluxo pede: ler fluxo.txt e ticket.txt e editar o ticket.
    tools: ['file_read', 'file_edit', 'file_write'],
  });
