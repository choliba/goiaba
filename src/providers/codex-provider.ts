import type {
  ProgramCommand,
  ProgramOutput,
} from '../execute/types.js';
import { debug } from '../log/index.js';
import type { Provider, ProviderEvent } from './types.js';

export interface CodexProviderOptions {
  readonly executable?: string;
  readonly model: string;
  readonly skipGitRepositoryCheck?: boolean;
}

export class CodexProvider implements Provider<string, string> {
  public readonly id = 'codex';

  private readonly executable: string;
  private readonly model: string;
  private readonly skipGitRepositoryCheck: boolean;

  public constructor({
    executable = 'codex',
    model,
    skipGitRepositoryCheck = false,
  }: CodexProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
    this.skipGitRepositoryCheck = skipGitRepositoryCheck;
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    const commonArguments = [
      ...(this.skipGitRepositoryCheck ? ['--skip-git-repo-check'] : []),
      '--json',
      '--model',
      this.model,
    ];

    return {
      executable: this.executable,
      arguments:
        sessionId === undefined
          ? ['exec', ...commonArguments, '--color', 'never', '-']
          : [
              'exec',
              '--color',
              'never',
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

    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      return { type: 'session', id: event.thread_id };
    }

    if (event.type !== 'item.completed') {
      return undefined;
    }

    const item = event.item;

    if (!isRecord(item)) {
      return undefined;
    }

    if (item.type === 'command_execution') {
      debug({
        type: 'tool',
        tool: 'shell',
        command: item.command,
        cwd: item.cwd,
        exitCode: item.exit_code ?? item.exitCode,
      });
    }

    if (item.type !== 'agent_message' || typeof item.text !== 'string') {
      return undefined;
    }

    return createEvent(item.text);
  } catch {
    return createEvent(line);
  }
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
