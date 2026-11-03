/** Defaults of the providers. */

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
