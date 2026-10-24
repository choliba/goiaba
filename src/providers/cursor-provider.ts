import type {
  ProgramCommand,
  ProgramOutput,
} from '../execute/types.js';
import type { Provider, ProviderEvent } from './types.js';

export interface CursorProviderOptions {
  readonly executable?: string;
  readonly model: string;
  readonly force?: boolean;
  readonly trust?: boolean;
}

export class CursorProvider implements Provider<string, string> {
  public readonly id = 'cursor';

  private readonly executable: string;
  private readonly model: string;
  private readonly force: boolean;
  private readonly trust: boolean;

  public constructor({
    executable = 'agent',
    model,
    force = false,
    trust = true,
  }: CursorProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
    this.force = force;
    this.trust = trust;
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    return {
      executable: this.executable,
      arguments: [
        '--print',
        '--output-format',
        'stream-json',
        '--model',
        this.model,
        ...(this.trust ? ['--trust'] : []),
        ...(this.force ? ['--force'] : []),
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
        yield { type: 'output', value: chunk };
        continue;
      }

      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        for (const event of readEvents(line, { sawAssistant, sessionEmitted })) {
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
      for (const event of readEvents(stdout, { sawAssistant, sessionEmitted })) {
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
      typeof event.session_id === 'string' &&
      event.session_id.length > 0
    ) {
      events.push({ value: { type: 'session', id: event.session_id } });
    }

    if (event.type === 'assistant') {
      const text = readAssistantText(event.message);

      if (text !== undefined) {
        events.push({ value: createEvent(text), source: 'assistant' });
      }

      return events;
    }

    if (
      event.type === 'result' &&
      !sawAssistant &&
      typeof event.result === 'string'
    ) {
      events.push({ value: createEvent(event.result) });
    }

    return events;
  } catch {
    return [{ value: createEvent(line) }];
  }
}

function readAssistantText(message: unknown): string | undefined {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return undefined;
  }

  const parts: string[] = [];

  for (const block of message.content) {
    if (
      isRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text);
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
    '- Se precisar de uma informação do usuário, faça somente uma pergunta direta.',
    '- A pergunta deve terminar com "?".',
    '- Encerre o turno imediatamente após a pergunta e não continue a tarefa.',
    '- Quando receber a resposta no próximo turno, continue a tarefa normalmente.',
  ].join('\n')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
