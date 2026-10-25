import type { ProgramCommand, ProgramOutput } from '../execute/types.js';
import { UsageError } from '../errors.js';
import { debug, logError, truncateError } from '../log/index.js';
import { delegatedCategories, type AgentPermissions } from '../policy/index.js';
import type { Provider, ProviderEvent, ProviderOptions } from './types.js';

// Tools that touch files; the sandbox decides which paths they reach.
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];

interface ClaudeSettings {
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
}

export class ClaudeProvider implements Provider<string, string> {
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

  public applyPermissions(permissions: AgentPermissions): void {
    const unsupported = delegatedCategories(permissions).find(
      (category) => category !== 'execution',
    );

    if (unsupported !== undefined) {
      throw new UsageError(
        `O provider claude ainda não aplica a categoria ${unsupported}.`,
      );
    }

    if (!delegatedCategories(permissions).includes('execution')) {
      return;
    }

    if ((permissions.requireApproval?.execution?.length ?? 0) > 0) {
      throw new UsageError(
        'O provider claude não tem como pedir aprovação de execution no --print.',
      );
    }

    if (permissions.default !== 'deny') {
      throw new UsageError(
        'permissions.execution no claude exige default deny.',
      );
    }

    const allow = permissions.allow?.execution ?? [];
    const deny = permissions.deny?.execution ?? [];

    if (deny.some((rule) => (rule.ignores?.commands?.length ?? 0) > 0)) {
      throw new UsageError(
        'ignores em regras deny de execution não têm equivalente no claude.',
      );
    }

    this.settings = {
      permissions: {
        // Files are confined by the sandbox; dontAsk would otherwise deny them.
        allow: [
          ...FILE_TOOLS,
          ...allow.flatMap((rule) => rule.commands.map(bashRule)),
        ],
        // ignores become deny: never broader than the policy, possibly stricter.
        deny: [
          ...allow.flatMap((rule) =>
            (rule.ignores?.commands ?? []).map(bashRule),
          ),
          ...deny.flatMap((rule) => rule.commands.map(bashRule)),
        ],
      },
    };
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    // --print has nobody to approve tools: with execution rules only what they
    // allow runs; otherwise the sandbox is the limit.
    const permissionMode =
      this.settings === undefined ? 'bypassPermissions' : 'dontAsk';

    return {
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
    };
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
      logToolResults(event['message'], tools);
      return events;
    }

    if (event['type'] === 'assistant') {
      logToolUses(event['message'], tools);
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

/**
 * Wildmatch command selector -> Claude `Bash(...)` rule. In commands, `*` and
 * `**` mean "any sequence" (the CLI's semantics); `?`, `[]` and escapes have
 * no equivalent and are refused.
 */
function bashRule(pattern: string): string {
  if (/[?[\]\\()]/.test(pattern)) {
    throw new UsageError(
      `O padrão de comando não tem equivalente no claude: ${pattern}`,
    );
  }

  return `Bash(${pattern.replaceAll('**', '*')})`;
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

function logToolUses(message: unknown, tools: Map<string, ToolCall>): void {
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

    debug({ type: 'tool', call_id: id, ...call });
  }
}

function logToolResults(message: unknown, tools: Map<string, ToolCall>): void {
  for (const block of contentBlocks(message)) {
    if (block['type'] !== 'tool_result') {
      continue;
    }

    const id = block['tool_use_id'];
    const call = typeof id === 'string' ? tools.get(id) : undefined;
    const text = toolResultText(block['content']);

    if (block['is_error'] === true) {
      logError({
        type: 'tool_error',
        provider: 'claude',
        call_id: id,
        ...call,
        message: truncateError(text),
      });
    } else {
      debug({
        type: 'tool_result',
        call_id: id,
        tool: call?.tool,
        bytes: text.length,
      });
    }
  }
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
