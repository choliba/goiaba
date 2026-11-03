import { userHome } from '../execute/process';
import type { ProgramCommand, ProgramOutput } from '../execute/types';
import { join } from '../filesystem/index';
import type {
  Provider,
  ProviderDescription,
  ProviderEvent,
  ProviderOptions,
  ToolEvent,
  HostAccess,
} from './types';

export class CursorProvider implements Provider<string, string> {
  public readonly id = 'cursor';

  private readonly executable: string;
  private readonly model: string;

  public constructor({ executable = 'agent', model }: ProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
  }

  public describe(): ProviderDescription {
    return { name: 'cursor', model: this.model };
  }

  /** Its state and its install; it logs in with CURSOR_API_KEY. */
  public hostAccess(): HostAccess {
    const home = userHome();
    return {
      programs: [join(home, '.local/share/cursor-agent')],
      credentialFiles: [join(home, '.config/cursor/auth.json')],
      credentialEnv: ['CURSOR_API_KEY'],
      sharedState: [
        join(home, '.cursor'),
        join(home, '.config/cursor'),
        join(home, '.local/share/cursor-agent'),
      ],
    };
  }

  public createCommand(
    input: string,
    sessionId?: string,
    workspaceRoot?: string,
  ): ProgramCommand {
    return {
      executable: this.executable,
      arguments: [
        '--print',
        '--output-format',
        'stream-json',
        '--model',
        this.model,
        ...(workspaceRoot === undefined ? [] : ['--workspace', workspaceRoot]),
        // --print has nobody to approve commands; the sandbox is the limit.
        '--trust',
        '--force',
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
      })) {
        yield event.value;
      }
    }
  }
}

interface ParseState {
  readonly sawAssistant: boolean;
  readonly sessionEmitted: boolean;
}

interface ParsedEvent {
  readonly value: ProviderEvent<string>;
  readonly source?: 'assistant';
}

function readEvents(
  line: string,
  { sawAssistant, sessionEmitted }: ParseState,
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

    if (event['type'] === 'tool_call') {
      const tool = toolCall(event);
      if (tool !== undefined) events.push({ value: tool });
    }

    if (event['type'] === 'assistant') {
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

function readAssistantText(message: unknown): string | undefined {
  if (!isRecord(message) || !Array.isArray(message['content'])) {
    return undefined;
  }

  const parts: string[] = [];

  for (const block of message['content']) {
    if (
      isRecord(block) &&
      block['type'] === 'text' &&
      typeof block['text'] === 'string'
    ) {
      parts.push(block['text']);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join('');
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

function toolCall(event: Record<string, unknown>): ToolEvent | undefined {
  if (!isRecord(event['tool_call'])) {
    return undefined;
  }

  const entry = Object.entries(event['tool_call']).at(0);

  if (entry === undefined) {
    return undefined;
  }

  const [rawName, payload] = entry;
  const body = isRecord(payload) ? payload : {};

  return {
    type: 'tool',
    phase: 'call',
    detail: {
      subtype: event['subtype'],
      call_id: event['call_id'],
      tool: rawName.replace(/ToolCall$/, ''),
      args: sanitizeToolValue(body['args']),
      result: sanitizeToolResult(body['result']),
    },
  };
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
    if (key === 'parsingResult') {
      continue;
    }

    if (
      (key === 'fileText' ||
        key === 'contents' ||
        key === 'old_string' ||
        key === 'new_string' ||
        key === 'stdout' ||
        key === 'stderr') &&
      typeof nested === 'string'
    ) {
      sanitized[key] = { bytes: nested.length };
      continue;
    }

    sanitized[key] = sanitizeToolValue(nested);
  }

  return sanitized;
}

function sanitizeToolResult(result: unknown): unknown {
  if (result === undefined) {
    return undefined;
  }

  return sanitizeToolValue(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
