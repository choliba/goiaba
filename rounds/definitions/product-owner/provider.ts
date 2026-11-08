import {
  OllamaProvider,
  type AgentProvider,
  type OllamaProviderOptions,
} from '../../../src';

/** O provider desta rodada: um modelo local no Ollama, conduzido por um CLI. */
export const ProductOwnerProvider = (
  options: OllamaProviderOptions,
): AgentProvider => new OllamaProvider(options);
