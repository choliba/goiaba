/** Defaults of the providers. */

/**
 * The CLIs that can drive a model on Ollama (`OllamaProvider`, option
 * `cli`): they run the tools and apply the policy. The pages offer the same.
 */
export const OLLAMA_CLIS = ['claude', 'codex'] as const;

/**
 * Destinations Codex reaches on its own, in the background, whatever the
 * model (it syncs from GitHub): never part of the task. Denied quietly, so
 * they do not wait in the approvals queue, where nobody answers in a round.
 */
export const CODEX_BACKGROUND_ENDPOINTS = [
  'github.com:443',
  'api.github.com:443',
] as const;

/** Where Ollama listens unless told otherwise (`OllamaProvider`, option `baseUrl`). */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/**
 * Tokens of a local model's context window when the model does not say
 * (`OllamaProvider`, option `contextWindow`): Ollama's usual 32k.
 */
export const DEFAULT_CONTEXT_WINDOW = 32_768;

/**
 * The part of the context window that, once used, makes the CLI compact the
 * conversation (`OllamaProvider`, option `compactAt`). At 80% there is still
 * room for the summary itself.
 */
export const COMPACT_AT = 0.8;
