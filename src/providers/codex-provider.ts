import type { ProgramCommand, ProgramOutput } from '../execute/types.js';
import { debug, logError, truncateError } from '../log/index.js';
import type { Provider, ProviderEvent, ProviderOptions } from './types.js';

export class CodexProvider implements Provider<string, string> {
  public readonly id = 'codex';

  private readonly executable: string;
  private readonly model: string;

  public constructor({ executable = 'codex', model }: ProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    const commonArguments = [
      // The jail hides the parent repository; the sandbox is the boundary.
      '--skip-git-repo-check',
      '--json',
      '--model',
      this.model,
    ];
    // Exec-level flags: `resume` does not accept them after the subcommand.
    // Workspace already runs the whole CLI inside Docker/Bubblewrap. A second
    // Linux sandbox here would try to create namespaces inside that jail.
    const execArguments = [
      '--sandbox',
      'danger-full-access',
      '--color',
      'never',
    ];

    return {
      executable: this.executable,
      arguments:
        sessionId === undefined
          ? ['exec', ...execArguments, ...commonArguments, '-']
          : [
              'exec',
              ...execArguments,
              'resume',
              ...commonArguments,
              sessionId,
              '-',
            ],
      input: appendInteractionProtocol(input),
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let stdout = '';

    for await (const { channel, chunk } of output) {
      if (channel === 'stderr') {
        yield { type: 'output', value: chunk };
        continue;
      }

      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        const event = readEvent(line);

        if (event !== undefined) {
          yield event;
        }
      }
    }

    if (stdout.length > 0) {
      const event = readEvent(stdout);

      if (event !== undefined) {
        yield event;
      }
    }
  }
}

function createEvent(text: string): ProviderEvent<string> {
  if (text.trimEnd().endsWith('?')) {
    return { type: 'ask', question: text };
  }

  return { type: 'output', value: text };
}

function readEvent(line: string): ProviderEvent<string> | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }

  try {
    const event: unknown = JSON.parse(line);

    if (!isRecord(event)) {
      return undefined;
    }

    if (
      event['type'] === 'thread.started' &&
      typeof event['thread_id'] === 'string'
    ) {
      return { type: 'session', id: event['thread_id'] };
    }

    if (event['type'] !== 'item.completed') {
      return undefined;
    }

    const item = event['item'];

    if (!isRecord(item)) {
      return undefined;
    }

    if (item['type'] === 'command_execution') {
      const exitCode = item['exit_code'] ?? item['exitCode'];
      const call = {
        tool: 'shell',
        command: item['command'],
        cwd: item['cwd'],
        exitCode,
      };
      debug({ type: 'tool', ...call });

      if (typeof exitCode === 'number' && exitCode !== 0) {
        const output = item['aggregated_output'];
        logError({
          type: 'tool_error',
          provider: 'codex',
          ...call,
          message: truncateError(typeof output === 'string' ? output : ''),
        });
      }
    }

    if (item['type'] !== 'agent_message' || typeof item['text'] !== 'string') {
      return undefined;
    }

    return createEvent(item['text']);
  } catch {
    return createEvent(line);
  }
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
