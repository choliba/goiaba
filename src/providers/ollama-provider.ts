import { UsageError } from '../errors';
import type { ProgramCommand, ProgramOutput } from '../execute/types';
import { reportDebug } from '../output/activity';
import type { AgentPolicy } from '../policy/index';
import { wrapCommand } from '../workspace/sandbox/wrap-command';
import { ClaudeProvider } from './claude/claude-provider';
import { CodexProvider } from './codex/codex-provider';
import type {
  ExecutionGate,
  Provider,
  ProviderDescription,
  ProviderEvent,
  ProviderOptions,
} from './types';

export type OllamaCli = 'claude' | 'codex';

export interface OllamaProviderOptions extends ProviderOptions {
  readonly cli: OllamaCli;
  /** Ollama server; defaults to the local one. */
  readonly baseUrl?: string;
  /**
   * Tokens the model is loaded with in Ollama (`ollama ps`, CONTEXT). The
   * CLIs would assume the model's maximum and never compact the history;
   * with this they compact before going past it.
   */
  readonly contextWindow?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** Ollama's default context here (`ollama ps` shows 32768). */
const DEFAULT_CONTEXT_WINDOW = 32_768;
/** Codex compacts at this share of the window, leaving room to answer. */
const COMPACT_AT = 0.8;

/**
 * stderr lines the CLIs print only because they talk to Ollama: an unknown
 * model name, the claude.ai login being overridden, Codex failing to read
 * Ollama's model list. They go to the debug log instead of the output.
 */
const OLLAMA_NOISE = [
  /\[claude-code:unrecognized_model\]/,
  /claude\.ai connectors are disabled/,
  /codex_models_manager.*failed to refresh available models/,
];

/**
 * Runs the Claude Code or Codex CLI against an Ollama model. The CLI's own
 * provider builds the command and parses its output; this one only points it
 * at Ollama through environment variables.
 */
export class OllamaProvider implements Provider<string, string> {
  public readonly id: string;

  private readonly inner: ClaudeProvider | CodexProvider;
  private readonly env: readonly string[];
  private readonly cli: OllamaCli;
  private readonly model: string;
  private readonly contextWindow: number;
  private readonly endpoint: string;

  public constructor(options: OllamaProviderOptions) {
    const baseUrl = readBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.id = `ollama-${options.cli}`;
    this.endpoint = endpointOf(baseUrl);
    this.cli = options.cli;
    this.model = options.model;
    this.contextWindow = readContextWindow(
      options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    );

    const providerOptions: ProviderOptions = {
      model: options.model,
      ...(options.executable === undefined
        ? {}
        : { executable: options.executable }),
    };

    if (options.cli === 'claude') {
      this.inner = new ClaudeProvider(providerOptions);
      this.env = claudeEnv(baseUrl, options.model, this.contextWindow);
    } else {
      this.inner = new CodexProvider(providerOptions);
      this.env = [
        `CODEX_OSS_BASE_URL=${baseUrl}/v1`,
        // Codex 0.163 tries to decode Ollama's /models response as its own
        // catalog and logs a harmless error twice. Hide only that Rust target.
        'RUST_LOG=error,codex_models_manager=off',
      ];
    }
  }

  public describe(): ProviderDescription {
    return { name: 'ollama', model: this.model, cli: this.cli };
  }

  /** Only Ollama: the CLI is pointed at it instead of its own API. */
  public networkEndpoints(): readonly string[] {
    return [this.endpoint];
  }

  /** Same policy enforcement as the CLI's own provider (execution gate). */
  public applyPermissions(
    permissions: AgentPolicy,
    gate: ExecutionGate | undefined,
  ): readonly string[] {
    if (this.inner instanceof CodexProvider && hasWebPermissions(permissions)) {
      throw new UsageError(
        'O Ollama não oferece a ferramenta web_search hospedada do Codex; ' +
          'use uma ferramenta local sujeita a permissions.execution.',
      );
    }

    return this.inner.applyPermissions(permissions, gate);
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    const command = this.inner.createCommand(input, sessionId);

    return wrapCommand(
      'env',
      this.env,
      this.inner instanceof CodexProvider
        ? withOssFlags(command, this.contextWindow)
        : command,
    );
  }

  public parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    return this.inner.parseOutput(withoutOllamaNoise(output));
  }
}

function hasWebPermissions(permissions: AgentPolicy): boolean {
  return (
    (permissions.allow?.web?.length ?? 0) > 0 ||
    (permissions.deny?.web?.length ?? 0) > 0 ||
    (permissions.requireApproval?.web?.length ?? 0) > 0
  );
}

function endpointOf(baseUrl: string): string {
  const url = new URL(baseUrl);
  const port =
    url.port.length > 0 ? url.port : url.protocol === 'https:' ? '443' : '80';
  // `[::1]` → `::1`, as the network gate writes hosts.
  return `${url.hostname.replace(/^\[(.*)\]$/, '$1')}:${port}`;
}

function readBaseUrl(value: string): string {
  if (!URL.canParse(value)) {
    throw new UsageError(`baseUrl do Ollama inválida: ${value}`);
  }

  return value.replace(/\/+$/, '');
}

function claudeEnv(
  baseUrl: string,
  model: string,
  contextWindow: number,
): readonly string[] {
  return [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    'ANTHROPIC_AUTH_TOKEN=ollama',
    'ANTHROPIC_API_KEY=',
    // Without these, background and subagent calls still go to Anthropic.
    `ANTHROPIC_DEFAULT_HAIKU_MODEL=${model}`,
    `ANTHROPIC_DEFAULT_SONNET_MODEL=${model}`,
    `ANTHROPIC_DEFAULT_OPUS_MODEL=${model}`,
    `CLAUDE_CODE_SUBAGENT_MODEL=${model}`,
    // An unknown model gets a guessed window and the history is never
    // compacted: the real one, enforced.
    `CLAUDE_CODE_MAX_CONTEXT_TOKENS=${String(contextWindow)}`,
    `CLAUDE_CODE_AUTO_COMPACT_WINDOW=${String(contextWindow)}`,
  ];
}

/**
 * `[env ...] codex exec [--oss ...] ...`: OSS flags belong to `exec`, before
 * `resume`. The codex provider may prefix the command with `env CODEX_HOME=…`.
 */
function readContextWindow(tokens: number): number {
  if (!Number.isInteger(tokens) || tokens <= 0) {
    throw new UsageError(
      `contextWindow deve ser um número inteiro de tokens: ${String(tokens)}`,
    );
  }
  return tokens;
}

function withOssFlags(
  command: ProgramCommand,
  contextWindow: number,
): ProgramCommand {
  const args = command.arguments ?? [];
  const exec = args.indexOf('exec');

  if (exec === -1) {
    throw new Error('O comando do codex deveria ter o subcomando exec.');
  }

  return {
    ...command,
    arguments: [
      ...args.slice(0, exec + 1),
      '--oss',
      '--local-provider',
      'ollama',
      // ChatGPT connectors and goals crowd out the shell tool for local models.
      '--disable',
      'apps',
      '--disable',
      'goals',
      // Codex takes the model's maximum (258k) and never compacts otherwise.
      '-c',
      `model_context_window=${String(contextWindow)}`,
      '-c',
      `model_auto_compact_token_limit=${String(Math.floor(contextWindow * COMPACT_AT))}`,
      ...args.slice(exec + 1),
    ],
  };
}

async function* withoutOllamaNoise(
  output: AsyncIterable<ProgramOutput>,
): AsyncIterable<ProgramOutput> {
  for await (const value of output) {
    if (value.channel === 'stdout') {
      yield value;
      continue;
    }

    const kept = value.chunk.split('\n').filter((line) => {
      const noise = OLLAMA_NOISE.some((pattern) => pattern.test(line));
      if (noise) reportDebug({ type: 'provider-noise', line });
      return !noise;
    });

    if (kept.some((line) => line.trim().length > 0)) {
      yield { channel: 'stderr', chunk: kept.join('\n') };
    }
  }
}
