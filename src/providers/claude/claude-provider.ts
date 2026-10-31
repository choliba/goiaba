import { homedir } from 'node:os';

import type { ProgramCommand, ProgramOutput } from '../../execute/types';
import { join } from '../../filesystem/index';
import { UsageError } from '../../errors';
import { truncateError } from '../../logger/index';
import { wrapCommand } from '../../workspace/sandbox/wrap-command';
import { delegatedCategories, type AgentPolicy } from '../../policy/index';
import { buildClaudePermissions, type ClaudePermissions } from './permissions';
import type {
  Provider as ProviderContract,
  ProviderPermissions,
} from '../provider.interface';
import type {
  ExecutionGate,
  Provider,
  ProviderDescription,
  ProviderEvent,
  ProviderOptions,
  ToolEvent,
  HostAccess,
} from '../types';

// Tools that touch files; the sandbox decides which paths they reach.
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];

/** Long enough for a person to answer an approval prompt. */
const HOOK_TIMEOUT_SECONDS = 3600;

interface ClaudeSettings {
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  readonly hooks?: {
    readonly PreToolUse: readonly {
      readonly matcher: string;
      readonly hooks: readonly {
        readonly type: 'command';
        readonly command: string;
        readonly timeout: number;
        readonly onFailure: 'block';
      }[];
    }[];
  };
}

export class ClaudeProvider
  implements
    Provider<string, string>,
    ProviderContract<string, string, ClaudePermissions>
{
  public readonly id = 'claude';

  private readonly executable: string;
  private readonly model: string;
  private settings: ClaudeSettings | undefined;

  public constructor({ executable = 'claude', model }: ProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
  }

  /** The policy as Claude Code's `allow`, `ask` and `deny` rules. */
  public buildPermissions(
    policy: AgentPolicy,
  ): ProviderPermissions<ClaudePermissions> {
    return buildClaudePermissions(policy);
  }

  public describe(): ProviderDescription {
    return { name: 'claude', model: this.model };
  }

  /** Its state (sessions, settings), its install, and its login. */
  public hostAccess(): HostAccess {
    const home = homedir();
    return {
      state: [
        join(home, '.claude'),
        join(home, '.claude.json'),
        join(home, '.local/share/claude'),
      ],
      credentialFiles: [join(home, '.claude/.credentials.json')],
      credentialEnv: [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
      ],
    };
  }

  /** The Messages API, and where a claude.ai login refreshes its token. */
  public networkEndpoints(): readonly string[] {
    return ['api.anthropic.com:443', 'console.anthropic.com:443'];
  }

  public applyPermissions(
    permissions: AgentPolicy,
    gate: ExecutionGate | undefined,
  ): readonly string[] {
    const categories = delegatedCategories(permissions);
    const unsupported = categories.find(
      (category) => category !== 'execution' && category !== 'web',
    );

    if (unsupported !== undefined) {
      throw new UsageError(
        `O provider claude ainda não aplica a categoria ${unsupported}.`,
      );
    }

    if (gate === undefined && !categories.includes('web')) return [];

    const web = webSettings(this.buildPermissions(permissions));

    // dontAsk runs only what is pre-approved: file tools (the sandbox limits
    // their paths), the web tools the rules allow and Bash calls the gate's
    // hook allows. Without execution rules the sandbox is Bash's limit.
    this.settings = {
      permissions: {
        allow: [
          ...FILE_TOOLS,
          ...(gate === undefined ? ['Bash'] : []),
          ...web.allow,
        ],
        deny: web.deny,
      },
      ...(gate === undefined
        ? {}
        : {
            hooks: {
              PreToolUse: [
                {
                  matcher: 'Bash',
                  hooks: [
                    {
                      type: 'command',
                      command: shellJoin(gate.hookCommand),
                      timeout: HOOK_TIMEOUT_SECONDS,
                      // A hook that times out must block, not let the call
                      // through.
                      onFailure: 'block',
                    },
                  ],
                },
              ],
            },
          }),
    };
    return [];
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    // --print has nobody to approve tools: with execution rules only what they
    // allow runs; otherwise the sandbox is the limit.
    const permissionMode =
      this.settings === undefined ? 'bypassPermissions' : 'dontAsk';

    // Only the model API: no telemetry, error reports or update checks, which
    // under network rules would each wait for an approval.
    return wrapCommand('env', ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'], {
      executable: this.executable,
      arguments: [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        this.model,
        '--permission-mode',
        permissionMode,
        // User/project settings could allow more than the policy (or hook it).
        ...(this.settings === undefined
          ? []
          : [
              '--setting-sources',
              '',
              '--settings',
              JSON.stringify(this.settings),
            ]),
        ...(sessionId === undefined ? [] : ['--resume', sessionId]),
      ],
      input: appendInteractionProtocol(input),
    });
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let stdout = '';
    let sawAssistant = false;
    let sessionEmitted = false;
    const tools = new Map<string, ToolCall>();

    for await (const { channel, chunk } of output) {
      if (channel === 'stderr') {
        yield { type: 'output', value: chunk };
        continue;
      }

      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        for (const event of readEvents(line, {
          sawAssistant,
          sessionEmitted,
          tools,
        })) {
          if (event.value.type === 'session') {
            sessionEmitted = true;
          } else if (event.source === 'assistant') {
            sawAssistant = true;
          }

          yield event.value;
        }
      }
    }

    if (stdout.length > 0) {
      for (const event of readEvents(stdout, {
        sawAssistant,
        sessionEmitted,
        tools,
      })) {
        yield event.value;
      }
    }
  }
}

interface ParseState {
  readonly sawAssistant: boolean;
  readonly sessionEmitted: boolean;
  /** tool_use by id, to name the tool when its result arrives. */
  readonly tools: Map<string, ToolCall>;
}

interface ToolCall {
  readonly tool: unknown;
  readonly args: unknown;
}

interface ParsedEvent {
  readonly value: ProviderEvent<string>;
  readonly source?: 'assistant';
}

function readEvents(
  line: string,
  { sawAssistant, sessionEmitted, tools }: ParseState,
): readonly ParsedEvent[] {
  if (line.trim().length === 0) {
    return [];
  }

  try {
    const event: unknown = JSON.parse(line);

    if (!isRecord(event)) {
      return [];
    }

    const events: ParsedEvent[] = [];

    if (
      !sessionEmitted &&
      typeof event['session_id'] === 'string' &&
      event['session_id'].length > 0
    ) {
      events.push({ value: { type: 'session', id: event['session_id'] } });
    }

    if (event['type'] === 'user') {
      events.push(...toolResults(event['message'], tools));
      return events;
    }

    if (event['type'] === 'assistant') {
      events.push(...toolUses(event['message'], tools));
      const text = readAssistantText(event['message']);

      if (text !== undefined) {
        events.push({ value: createEvent(text), source: 'assistant' });
      }

      return events;
    }

    if (
      event['type'] === 'result' &&
      !sawAssistant &&
      typeof event['result'] === 'string'
    ) {
      events.push({ value: createEvent(event['result']) });
    }

    return events;
  } catch {
    return [{ value: createEvent(line) }];
  }
}

/** POSIX shell quoting for the hook command line. */
function shellJoin(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

/**
 * The web part of the translation, as the settings the CLI runs with. Refuses
 * what Claude would apply more loosely than the policy, and requireApproval:
 * with `--print` nobody answers an `ask`.
 */
function webSettings(translated: ProviderPermissions<ClaudePermissions>): {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
} {
  const looser = translated.unsupported.find(
    (rule) => rule.category === 'web' && rule.effect === 'looser',
  );
  if (looser !== undefined) {
    throw new UsageError(
      `O provider claude não aplica esta regra web: ${looser.reason}`,
    );
  }
  if (translated.native.ask.some(isWebRule)) {
    throw new UsageError(
      'O provider claude ainda não aplica requireApproval em web.',
    );
  }

  return {
    allow: translated.native.allow.filter(isWebRule),
    deny: translated.native.deny.filter(isWebRule),
  };
}

function isWebRule(rule: string): boolean {
  return rule.startsWith('WebFetch') || rule.startsWith('WebSearch');
}

function contentBlocks(message: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(message) || !Array.isArray(message['content'])) {
    return [];
  }

  return message['content'].filter(isRecord);
}

function readAssistantText(message: unknown): string | undefined {
  const parts = contentBlocks(message).flatMap((block) => {
    const text = block['text'];
    return block['type'] === 'text' && typeof text === 'string' ? [text] : [];
  });

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('');
}

function toolUses(
  message: unknown,
  tools: Map<string, ToolCall>,
): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const block of contentBlocks(message)) {
    if (block['type'] !== 'tool_use') {
      continue;
    }

    const call = {
      tool: block['name'],
      args: sanitizeToolValue(block['input']),
    };
    const id = block['id'];

    if (typeof id === 'string') {
      tools.set(id, call);
    }

    events.push(toolEvent('call', { call_id: id, ...call }));
  }

  return events;
}

function toolResults(
  message: unknown,
  tools: Map<string, ToolCall>,
): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const block of contentBlocks(message)) {
    if (block['type'] !== 'tool_result') {
      continue;
    }

    const id = block['tool_use_id'];
    const call = typeof id === 'string' ? tools.get(id) : undefined;
    const text = toolResultText(block['content']);

    events.push(
      block['is_error'] === true
        ? toolEvent('error', {
            provider: 'claude',
            call_id: id,
            ...call,
            message: truncateError(text),
          })
        : toolEvent('result', {
            call_id: id,
            tool: call?.tool,
            bytes: text.length,
          }),
    );
  }

  return events;
}

function toolEvent(
  phase: ToolEvent['phase'],
  detail: Record<string, unknown>,
): ParsedEvent {
  return { value: { type: 'tool', phase, detail } };
}

/** tool_result content is a string or a list of text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .flatMap((block) =>
      isRecord(block) && typeof block['text'] === 'string'
        ? [block['text']]
        : [],
    )
    .join('\n');
}

function sanitizeToolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeToolValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === 'content' || key === 'old_string' || key === 'new_string') &&
      typeof nested === 'string'
    ) {
      sanitized[key] = { bytes: nested.length };
      continue;
    }

    sanitized[key] = sanitizeToolValue(nested);
  }

  return sanitized;
}

function createEvent(text: string): ProviderEvent<string> {
  if (text.trimEnd().endsWith('?')) {
    return { type: 'ask', question: text };
  }

  return { type: 'output', value: text };
}

function appendInteractionProtocol(input: string): string {
  return `${input}\n\n${[
    'Regra de interação:',
    '- Nunca chame a ferramenta request_user_input.',
    '- Se precisar de uma informação do usuário, faça somente uma pergunta direta.',
    '- A pergunta deve terminar com "?".',
    '- Encerre o turno imediatamente após a pergunta e não continue a tarefa.',
    '- Quando receber a resposta no próximo turno, continue a tarefa normalmente.',
  ].join('\n')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
