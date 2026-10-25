import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { UsageError } from '../errors.js';
import type { ProgramCommand, ProgramOutput } from '../execute/types.js';
import { debug } from '../log/index.js';
import {
  delegatedCategories,
  type AgentPermissions,
  type ExecutionRule,
} from '../policy/index.js';
import { wrapCommand } from '../workspace/sandbox/wrap-command.js';
import { ClaudeProvider } from './claude-provider.js';
import { CodexProvider } from './codex-provider.js';
import type { Provider, ProviderEvent, ProviderOptions } from './types.js';

export type OllamaCli = 'claude' | 'codex';

export interface OllamaProviderOptions extends ProviderOptions {
  readonly cli: OllamaCli;
  /** Ollama server; defaults to the local one. */
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

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
  public readonly applyPermissions?: (permissions: AgentPermissions) => void;

  private readonly inner: ClaudeProvider | CodexProvider;
  private readonly env: string[];
  private codexHome: string | undefined;

  public constructor(options: OllamaProviderOptions) {
    const baseUrl = readBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.id = `ollama-${options.cli}`;

    const providerOptions: ProviderOptions = {
      model: options.model,
      ...(options.executable === undefined
        ? {}
        : { executable: options.executable }),
    };

    if (options.cli === 'claude') {
      const inner = new ClaudeProvider(providerOptions);
      this.inner = inner;
      this.applyPermissions = (permissions) => {
        inner.applyPermissions(permissions);
      };
      this.env = [...claudeEnv(baseUrl, options.model)];
    } else {
      this.inner = new CodexProvider(providerOptions);
      this.env = [`CODEX_OSS_BASE_URL=${baseUrl}/v1`];
      this.applyPermissions = (permissions) => {
        this.applyCodexPermissions(permissions);
      };
    }
  }

  public close(): void {
    if (this.codexHome !== undefined) {
      rmSync(this.codexHome, { recursive: true, force: true });
      this.codexHome = undefined;
    }

    for (let index = this.env.length - 1; index >= 0; index -= 1) {
      const entry = this.env[index];
      if (entry !== undefined && entry.startsWith('CODEX_HOME=')) {
        this.env.splice(index, 1);
      }
    }
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    const command = this.inner.createCommand(input, sessionId);

    return wrapCommand(
      'env',
      this.env,
      this.inner instanceof CodexProvider ? withOssFlags(command) : command,
    );
  }

  public parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    return this.inner.parseOutput(withoutOllamaNoise(output));
  }

  private applyCodexPermissions(permissions: AgentPermissions): void {
    const unsupported = delegatedCategories(permissions).find(
      (category) => category !== 'execution',
    );

    if (unsupported !== undefined) {
      throw new UsageError(
        `O provider ${this.id} ainda não aplica a categoria ${unsupported}.`,
      );
    }

    if (!delegatedCategories(permissions).includes('execution')) return;

    if ((permissions.requireApproval?.execution?.length ?? 0) > 0) {
      throw new UsageError(
        `O provider ${this.id} não pede aprovação no modo não interativo.`,
      );
    }

    if (permissions.default !== 'deny') {
      throw new UsageError(
        `permissions.execution no ${this.id} exige default deny.`,
      );
    }

    const cache = process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache');
    const goiabaCache = join(cache, 'goiaba');
    mkdirSync(goiabaCache, { recursive: true });
    const home = mkdtempSync(join(goiabaCache, 'codex-'));
    const rulesDir = join(home, 'rules');
    mkdirSync(rulesDir);

    try {
      const allow = permissions.allow?.execution ?? [];
      const deny = permissions.deny?.execution ?? [];
      const lines = [
        ...allow.flatMap((rule) => codexRules(rule, 'allow')),
        ...allow.flatMap((rule) =>
          codexRules({ commands: rule.ignores?.commands ?? [] }, 'forbidden'),
        ),
        ...deny.flatMap((rule) => codexRules(rule, 'forbidden')),
      ];
      writeFileSync(join(rulesDir, 'goiaba.rules'), `${lines.join('\n')}\n`, {
        mode: 0o600,
      });
      writeCodexExecutionHook(home, permissions);
    } catch (error) {
      rmSync(home, { recursive: true, force: true });
      throw error;
    }

    this.close();
    this.codexHome = home;
    this.env.push(`CODEX_HOME=${home}`);
  }
}

function codexRules(
  rule: ExecutionRule,
  decision: 'allow' | 'forbidden',
): string[] {
  return rule.commands.map((command) => {
    const pattern = codexPrefix(command);
    return `prefix_rule(pattern=${JSON.stringify(pattern)}, decision=${JSON.stringify(decision)})`;
  });
}

function writeCodexExecutionHook(
  home: string,
  permissions: AgentPermissions,
): void {
  const hook = join(home, 'execution-policy.mjs');
  const policy = JSON.stringify({
    default: permissions.default,
    allow: permissions.allow?.execution ?? [],
    deny: permissions.deny?.execution ?? [],
  });

  writeFileSync(
    hook,
    `import { readFileSync } from 'node:fs';
const policy = ${policy};
const input = JSON.parse(readFileSync(0, 'utf8'));
const command = input?.tool_input?.command;
const deny = (reason) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
}));
if (typeof command !== 'string') {
  deny('Comando inválido bloqueado pela política do agente.');
  process.exit(0);
}
if (/[\\n\\r;&|<>\x60]/.test(command) || command.includes('$(')) {
  deny('Comando composto ou com redirecionamento bloqueado pela política do agente.');
  process.exit(0);
}
const escape = (value) => value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
const compile = (pattern) => {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '\\\\') {
      index += 1;
      source += escape(pattern[index] ?? '');
    } else if (character === '?') {
      source += '[^/]';
    } else if (character === '*') {
      if (pattern[index + 1] === '*') {
        while (pattern[index + 1] === '*') index += 1;
        source += '.*';
      } else {
        source += '[^/]*';
      }
    } else if (character === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end === -1) throw new Error('invalid pattern');
      let content = pattern.slice(index + 1, end);
      if (content.startsWith('!')) content = '^' + content.slice(1);
      source += '[' + content.replaceAll('\\\\', '\\\\\\\\') + ']';
      index = end;
    } else {
      source += escape(character);
    }
  }
  return new RegExp(source + '$');
};
const matches = (patterns = []) => patterns.some((pattern) => compile(pattern).test(command));
const applies = (rule) => matches(rule.commands) && !matches(rule.ignores?.commands);
if (policy.deny.some(applies)) {
  deny('Comando bloqueado por permissions.deny.execution.');
} else if (policy.allow.some(applies)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  }));
} else {
  deny('Comando não autorizado por permissions.allow.execution.');
}
`,
    { mode: 0o700 },
  );

  writeFileSync(
    join(home, 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '^Bash$',
            hooks: [
              {
                type: 'command',
                command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hook)}`,
                timeout: 5,
              },
            ],
          },
        ],
      },
    })}\n`,
    { mode: 0o600 },
  );
}

function codexPrefix(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  const wildcard = tokens.findIndex((token) => token === '*' || token === '**');

  if (wildcard !== -1) {
    if (wildcard !== tokens.length - 1 || wildcard === 0) {
      throw new UsageError(
        `O padrão de comando não tem equivalente no codex: ${command}`,
      );
    }

    return tokens.slice(0, wildcard);
  }

  if (tokens.some((token) => /[*?[\]\\'"$;&|()<>]/.test(token))) {
    throw new UsageError(
      `O padrão de comando não tem equivalente no codex: ${command}`,
    );
  }

  return tokens;
}

function readBaseUrl(value: string): string {
  if (!URL.canParse(value)) {
    throw new UsageError(`baseUrl do Ollama inválida: ${value}`);
  }

  return value.replace(/\/+$/, '');
}

function claudeEnv(baseUrl: string, model: string): readonly string[] {
  return [
    `ANTHROPIC_BASE_URL=${baseUrl}`,
    'ANTHROPIC_AUTH_TOKEN=ollama',
    'ANTHROPIC_API_KEY=',
    // Without these, background and subagent calls still go to Anthropic.
    `ANTHROPIC_DEFAULT_HAIKU_MODEL=${model}`,
    `ANTHROPIC_DEFAULT_SONNET_MODEL=${model}`,
    `ANTHROPIC_DEFAULT_OPUS_MODEL=${model}`,
    `CLAUDE_CODE_SUBAGENT_MODEL=${model}`,
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
  ];
}

/** `codex exec [--oss ...] ...`: OSS flags belong to `exec`, before `resume`. */
function withOssFlags(command: ProgramCommand): ProgramCommand {
  const [subcommand, ...rest] = command.arguments ?? [];

  if (subcommand !== 'exec') {
    throw new Error('O comando do codex deveria começar com exec.');
  }

  return {
    ...command,
    arguments: [
      'exec',
      '--oss',
      '--local-provider',
      'ollama',
      '--dangerously-bypass-hook-trust',
      // ChatGPT connectors and goals crowd out the shell tool for local models.
      '--disable',
      'apps',
      '--disable',
      'goals',
      ...rest,
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
      if (noise) debug({ type: 'provider-noise', line });
      return !noise;
    });

    if (kept.some((line) => line.trim().length > 0)) {
      yield { channel: 'stderr', chunk: kept.join('\n') };
    }
  }
}
