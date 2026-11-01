import { UsageError } from '../errors';
import type { ProgramCommand, ProgramOutput } from '../execute/types';
import { log } from '../logger/index';
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
  HostAccess,
  LiveTurn,
  TrafficEvent,
} from './types';
import { readOllamaTraffic } from './ollama-traffic';

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
  /**
   * Only with `cli: 'claude'`: the tools the model sees (`ClaudeProvider`'s
   * `tools`). Claude Code's full set is ~15k tokens on every request.
   */
  readonly tools?: readonly string[];
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

  /**
   * Only with the Claude CLI, which takes messages on an open stdin: what
   * is typed while it works reaches it right away. Codex has no such input.
   */
  public readonly createLiveTurn?: (
    input: string,
    sessionId?: string,
  ) => LiveTurn;

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
      const claude = new ClaudeProvider({
        ...providerOptions,
        // A small local model takes the rules, repeated, as the request.
        rulesOnce: true,
        ...(options.tools === undefined ? {} : { tools: options.tools }),
      });
      const env = claudeEnv(baseUrl, options.model, this.contextWindow);
      this.inner = claude;
      this.env = env;
      this.createLiveTurn = (input, sessionId) => {
        const turn = claude.openLiveTurn(input, sessionId);
        return { ...turn, command: wrapCommand('env', env, turn.command) };
      };
    } else {
      if (options.tools !== undefined) {
        throw new UsageError(
          'A opção tools do OllamaProvider só vale com cli: claude. Tire-a ou use o Claude.',
        );
      }
      // Ollama needs no OpenAI login: the user's stays out of the sandbox.
      this.inner = new CodexProvider({
        ...providerOptions,
        login: false,
        rulesOnce: true,
      });
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

  /**
   * The CLI's state, but none of its credentials: the model is local, so
   * no login, token or key reaches the sandbox.
   */
  public hostAccess(): HostAccess {
    return {
      state: this.inner.hostAccess().state,
      credentialFiles: [],
      credentialEnv: [],
    };
  }

  /** Only Ollama: the CLI is pointed at it instead of its own API. */
  public networkEndpoints(): readonly string[] {
    return [this.endpoint];
  }

  /**
   * The CLI's own cloud (model lists, plugins, account), which it still
   * tries with a local model: never needed here.
   */
  public networkBlocked(): readonly string[] {
    return this.inner
      .networkEndpoints()
      .filter((endpoint) => endpoint !== this.endpoint);
  }

  /**
   * What Ollama answers, as it arrives: the text piece by piece and each
   * request's tokens. The same for both CLIs, whatever each one chooses to
   * print, and including the requests a CLI keeps to itself (a retry).
   */
  public readTraffic(
    responses: AsyncIterable<Uint8Array>,
  ): AsyncIterable<TrafficEvent> {
    return readOllamaTraffic(responses);
  }

  /** Same policy enforcement as the CLI's own provider (execution gate). */
  public applyPermissions(
    permissions: AgentPolicy,
    gate: ExecutionGate | undefined,
  ): readonly string[] {
    // Codex's web_search is hosted by OpenAI: through Ollama there is none.
    // No web at all is stricter than any web rule, so it is turned off
    // instead of refusing the policy.
    return this.inner instanceof CodexProvider
      ? this.inner.applyPermissions(withoutWeb(permissions), gate)
      : this.inner.applyPermissions(permissions, gate);
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
    return withoutPartials(this.inner.parseOutput(withoutOllamaNoise(output)));
  }
}

/**
 * The text pieces come from Ollama's traffic (`readTraffic`), for both
 * CLIs: the ones Claude Code also prints would show the text twice.
 */
async function* withoutPartials(
  events: AsyncIterable<ProviderEvent<string>>,
): AsyncIterable<ProviderEvent<string>> {
  for await (const event of events) {
    if (event.type !== 'partial') yield event;
  }
}

/** The same policy with every web operation denied (web_search off). */
function withoutWeb(permissions: AgentPolicy): AgentPolicy {
  return {
    ...permissions,
    allow: { ...permissions.allow, web: [] },
    requireApproval: { ...permissions.requireApproval, web: [] },
    deny: {
      ...permissions.deny,
      web: [{ operations: ['*'], domains: ['*'] }],
    },
  };
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
    // Small local models do not load deferred tools with ToolSearch first:
    // they call WebFetch without its schema and miss required parameters.
    'ENABLE_TOOL_SEARCH=false',
    // An unknown model gets a guessed window and the history is never
    // compacted: the real one, enforced.
    `CLAUDE_CODE_MAX_CONTEXT_TOKENS=${String(contextWindow)}`,
    `CLAUDE_CODE_AUTO_COMPACT_WINDOW=${String(contextWindow)}`,
    // Claude Code reserves 32k for the reply: in a 32k window that leaves no
    // room for the conversation, and every resumed turn is compacted first.
    `CLAUDE_CODE_MAX_OUTPUT_TOKENS=${String(Math.floor(contextWindow / 4))}`,
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
      if (noise) log.debug({ type: 'provider-noise', line });
      return !noise;
    });

    if (kept.some((line) => line.trim().length > 0)) {
      yield { channel: 'stderr', chunk: kept.join('\n') };
    }
  }
}
