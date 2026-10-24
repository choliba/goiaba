import { describe, expect, test } from 'bun:test';

import { CodexProvider } from '../src/providers/codex-provider.js';
import type { ProgramOutput } from '../src/execute/types.js';

describe('CodexProvider', () => {
  test('descreve o comando sem executá-lo', () => {
    const provider = new CodexProvider({
      executable: 'codex-custom',
      model: 'modelo',
    });

    const command = provider.createCommand('pergunta');

    expect(command).toMatchObject({
      executable: 'codex-custom',
      arguments: [
        'exec', '--json', '--model', 'modelo', '--color', 'never', '-',
      ],
    });
    expect(command.input).toStartWith('pergunta\n\nRegra de interação:');
  });

  test('interpreta mensagens JSON fragmentadas do Codex', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      { channel: 'stdout', chunk: '{"type":"thread.started"}\n' },
      {
        channel: 'stdout',
        chunk: '{"type":"item.completed","item":{"type":"agent_',
      },
      { channel: 'stdout', chunk: 'message","text":"resposta"}}\n' },
      { channel: 'stderr', chunk: 'diagnóstico' },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'output', value: 'resposta' },
      { type: 'output', value: 'diagnóstico' },
    ]);
  });

  test('classifica uma pergunta final como ask', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"agent_message","text":"Qual é o seu nome?"}}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'ask', question: 'Qual é o seu nome?' },
    ]);
  });

  test('permite executar fora de um repositório Git quando configurado', () => {
    const provider = new CodexProvider({
      model: 'modelo',
      skipGitRepositoryCheck: true,
    });

    expect(provider.createCommand('pergunta').arguments).toContain(
      '--skip-git-repo-check',
    );
  });

  test('cria um comando para retomar uma sessão', () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const command = provider.createCommand('dev', 'thread-123');

    expect(command.arguments).toEqual([
      'exec',
      '--color',
      'never',
      'resume',
      '--json',
      '--model',
      'modelo',
      'thread-123',
      '-',
    ]);
  });

  test('publica o identificador da sessão do Codex', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk: '{"type":"thread.started","thread_id":"thread-123"}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'thread-123' },
    ]);
  });
});

async function* source(
  values: readonly ProgramOutput[],
): AsyncIterable<ProgramOutput> {
  yield* values;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const value of values) {
    result.push(value);
  }

  return result;
}
