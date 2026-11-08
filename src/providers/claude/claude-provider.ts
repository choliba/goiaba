import { userHome } from '../../execute/process';
import { HOOK_TIMEOUT_SECONDS } from '../../approval/constants';

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
  LiveTurn,
  ProviderOptions,
  ToolEvent,
  TokenUsage,
  HostAccess,
} from '../types';
import type { GoiabaTool } from '../tools';

// Tools that touch files; the sandbox decides which paths they reach.
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];

/**
 * How each Goiaba capability becomes Claude Code tools (`--tools`). One
 * capability may map to several tools (`file_search` → Glob + Grep). A new
 * capability is one line here. Complete by construction: `satisfies` fails
 * the typecheck if one is missing.
 */
const CLAUDE_TOOLS = {
  file_read: ['Read'],
  file_write: ['Write'],
  file_edit: ['Edit'],
  file_list: ['Glob'],
  file_search: ['Glob', 'Grep'],
  web_fetch: ['WebFetch'],
  web_search: ['WebSearch'],
  shell: ['Bash'],
} satisfies Record<GoiabaTool, readonly string[]>;

/** The Claude Code tools for a set of Goiaba capabilities, in order, deduped. */
function claudeTools(tools: readonly GoiabaTool[]): readonly string[] {
  const names: string[] = [];
  for (const tool of tools) {
    const mapped = CLAUDE_TOOLS[tool] as readonly string[] | undefined;
    if (mapped === undefined) {
      throw new UsageError(
        `O provider claude ainda não traduz a ferramenta ${tool}.`,
      );
    }
    for (const name of mapped) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Long enough for a person to answer an approval prompt. */

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

export interface ClaudeProviderOptions extends ProviderOptions {
  /**
   * The capabilities the model sees, in Goiaba's vocabulary (`file_read`,
   * `shell`…); translated to the CLI's `--tools`. `[]` leaves none. Without
   * it, all of them: their definitions are most of every request, which a
   * small local model reads slowly and poorly.
   */
  readonly tools?: readonly GoiabaTool[];
  /**
   * The interaction rules go with the first message of a session only (the
   * history keeps them), not with every one. Default false: every message.
   * A small model reads them, each time, as part of the request.
   */
  readonly rulesOnce?: boolean;
}

export class ClaudeProvider
  implements
    Provider<string, string>,
    ProviderContract<string, string, ClaudePermissions>
{
  public readonly id = 'claude';

  private readonly executable: string;
  private readonly model: string;
  private readonly tools: readonly GoiabaTool[] | undefined;
  private readonly rulesOnce: boolean;
  private settings: ClaudeSettings | undefined;
  /** The live turn going on, whose messages each `result` answers. */
  private live: LiveChannel | undefined;

  public constructor({
    executable = 'claude',
    model,
    tools,
    rulesOnce = false,
  }: ClaudeProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
    this.tools = tools;
    this.rulesOnce = rulesOnce;
  }

  /** The policy as Claude Code's `allow`, `ask` and `deny` rules. */
  public buildPermissions(
    policy: AgentPolicy,
  ): ProviderPermissions<ClaudePermissions> {
    return buildClaudePermissions(policy);
  }

  public describe(): ProviderDescription {
    return {
      name: 'claude',
      model: this.model,
      ...(this.tools === undefined ? {} : { tools: this.tools }),
    };
  }

  /** Its state (sessions, settings), its install, and its login. */
  public hostAccess(): HostAccess {
    const home = userHome();
    return {
      programs: [join(home, '.local/share/claude')],
      sharedState: [
        join(home, '.claude'),
        join(home, '.claude.json'),
        join(home, '.local/share/claude'),
      ],
      credentialFiles: [join(home, '.claude/.credentials.json')],
      homeEnv: { CLAUDE_CONFIG_DIR: '.claude' },
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
    return this.command(sessionId, {
      input: this.withRules(input, sessionId === undefined),
    });
  }

  /**
   * The turn with stdin kept open (`--input-format stream-json`): each
   * message sent while it runs is written there as it comes and answered,
   * in order, by the same process, each turn ending with a `result`. Not a
   * `Provider` method: whoever wraps this provider decides to offer it.
   */
  public openLiveTurn(input: string, sessionId?: string): LiveTurn {
    const channel = new LiveChannel();
    this.live = channel;
    channel.send(this.withRules(input, sessionId === undefined));
    return {
      command: this.command(sessionId, { inputStream: channel.lines() }, [
        '--input-format',
        'stream-json',
      ]),
      // Never the session's first message: the one above opened it.
      send: (message) => channel.send(this.withRules(message, false)),
      close: () => channel.close(),
    };
  }

  /** The message with the interaction rules, unless they went already. */
  private withRules(message: string, opensSession: boolean): string {
    return this.rulesOnce && !opensSession
      ? message
      : appendInteractionProtocol(message);
  }

  private command(
    sessionId: string | undefined,
    stdin: Pick<ProgramCommand, 'input' | 'inputStream'>,
    inputFormat: readonly string[] = [],
  ): ProgramCommand {
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
        ...inputFormat,
        // The text also piece by piece (`stream_event`), before the message.
        '--include-partial-messages',
        '--model',
        this.model,
        '--permission-mode',
        permissionMode,
        // `--tools` takes every value up to the next flag; none is `''`.
        ...(this.tools === undefined
          ? []
          : [
              '--tools',
              ...(this.tools.length === 0 ? [''] : claudeTools(this.tools)),
            ]),
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
      ...stdin,
    });
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let stdout = '';
    let sawAssistant = false;
    let sessionEmitted = false;
    const tools = new Map<string, ToolCall>();
    const usage: UsageState = { pending: undefined, reportedCost: 0 };

    for await (const { channel, chunk } of output) {
      if (channel === 'stderr') {
        yield { type: 'stderr', text: chunk };
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
          onResult: () => this.live?.answered(),
          usage,
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
        onResult: () => this.live?.answered(),
        usage,
      })) {
        yield event.value;
      }
    }
    // Ended without a result (killed, say): what it reported still counts.
    for (const event of flushUsage(usage)) yield event.value;
  }
}

/**
 * The messages of a live turn, as stream-json lines for the CLI's stdin.
 * Ends when every message sent has been answered, or when closed.
 */
class LiveChannel {
  private readonly queue: string[] = [];
  private wake: (() => void) | undefined;
  private unanswered = 0;
  private closed = false;

  public send(message: string): boolean {
    if (this.closed) return false;
    this.unanswered += 1;
    this.queue.push(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message },
      })}\n`,
    );
    this.wake?.();
    return true;
  }

  public answered(): void {
    this.unanswered = Math.max(0, this.unanswered - 1);
    if (this.unanswered === 0) this.close();
  }

  public close(): void {
    this.closed = true;
    this.wake?.();
  }

  public async *lines(): AsyncIterable<string> {
    for (;;) {
      const next = this.queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}

interface ParseState {
  readonly sawAssistant: boolean;
  readonly sessionEmitted: boolean;
  /** tool_use by id, to name the tool when its result arrives. */
  readonly tools: Map<string, ToolCall>;
  /** A turn ended (`result`): one message of a live turn was answered. */
  readonly onResult?: () => void;
  readonly usage: UsageState;
}

/**
 * The usage of the assistant message being read. The CLI repeats the same
 * usage in every block of a message (same id), so it is told once, when the
 * message ends, with the tools the message called.
 */
interface UsageState {
  pending: { id: string; usage: TokenUsage; actions: string[] } | undefined;
  /** `total_cost_usd` of the last `result`: in a live turn it adds up. */
  reportedCost: number;
}

/** The usage of the message read so far, once: the next one began, or the turn ended. */
function flushUsage(state: UsageState): ParsedEvent[] {
  const pending = state.pending;
  state.pending = undefined;
  if (pending === undefined) return [];
  return [
    {
      value: {
        type: 'usage',
        usage: pending.usage,
        ...(pending.actions.length === 0
          ? {}
          : { action: pending.actions.join(', ') }),
      },
    },
  ];
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * A message's `usage`: `input_tokens` leaves out what came from the cache
 * and what went to it; `TokenUsage.input` is everything the model read.
 */
function messageUsage(usage: unknown): TokenUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const fresh = count(usage['input_tokens']);
  const cacheRead = count(usage['cache_read_input_tokens']);
  const cacheWrite = count(usage['cache_creation_input_tokens']);
  const details = usage['output_tokens_details'];
  const thinking = isRecord(details) ? details['thinking_tokens'] : undefined;
  return {
    input: fresh + cacheRead + cacheWrite,
    output: count(usage['output_tokens']),
    cachedInput: cacheRead,
    cacheWrite,
    ...(typeof thinking === 'number' ? { reasoning: count(thinking) } : {}),
  };
}

/** The usage and tools of one block of an assistant message. */
function readUsage(message: unknown, state: UsageState): ParsedEvent[] {
  if (!isRecord(message) || typeof message['id'] !== 'string') return [];
  const events: ParsedEvent[] = [];
  if (state.pending?.id !== message['id']) {
    events.push(...flushUsage(state));
    const usage = messageUsage(message['usage']);
    if (usage === undefined) return events;
    state.pending = { id: message['id'], usage, actions: [] };
  }
  for (const block of contentBlocks(message)) {
    if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
      state.pending.actions.push(block['name']);
    }
  }
  return events;
}

/** What this `result` adds to the cost the CLI already reported. */
function resultCost(
  event: Record<string, unknown>,
  state: UsageState,
): ParsedEvent[] {
  const total = event['total_cost_usd'];
  if (typeof total !== 'number' || !Number.isFinite(total)) return [];
  const usd = total - state.reportedCost;
  state.reportedCost = Math.max(total, state.reportedCost);
  return usd > 0 ? [{ value: { type: 'cost', usd } }] : [];
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
  { sawAssistant, sessionEmitted, tools, onResult, usage }: ParseState,
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

    // A failed result names a session without opening it: the CLI answers
    // `--resume` of a session it no longer has with only that line.
    if (
      !sessionEmitted &&
      typeof event['session_id'] === 'string' &&
      event['session_id'].length > 0 &&
      !(event['type'] === 'result' && event['is_error'] === true)
    ) {
      events.push({ value: { type: 'session', id: event['session_id'] } });
    }

    if (event['type'] === 'user') {
      events.push(...flushUsage(usage));
      events.push(...toolResults(event['message'], tools));
      return events;
    }

    if (event['type'] === 'stream_event') {
      const text = textDelta(event['event']);
      if (text !== undefined) {
        events.push({ value: { type: 'partial', text } });
      }
      return events;
    }

    if (event['type'] === 'assistant') {
      events.push(...readUsage(event['message'], usage));
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

    if (event['type'] === 'result') {
      events.push(...flushUsage(usage), ...resultCost(event, usage));
      onResult?.();
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

/** The text of a `content_block_delta`; thinking and tool input are not. */
function textDelta(event: unknown): string | undefined {
  if (!isRecord(event) || event['type'] !== 'content_block_delta') {
    return undefined;
  }
  const delta = event['delta'];
  if (
    !isRecord(delta) ||
    delta['type'] !== 'text_delta' ||
    typeof delta['text'] !== 'string' ||
    delta['text'].length === 0
  ) {
    return undefined;
  }
  return delta['text'];
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
