import { describe, expect, test } from 'bun:test';

import { CursorProvider } from '../src/providers/cursor-provider.js';
import type { ProgramOutput } from '../src/execute/types.js';

describe('CursorProvider', () => {
  test('descreve o comando sem executá-lo', () => {
    const provider = new CursorProvider({
      executable: 'cursor-custom',
      model: 'modelo',
    });

    const command = provider.createCommand('pergunta');

    expect(command).toMatchObject({
      executable: 'cursor-custom',
      arguments: [
        '--print',
        '--output-format',
        'stream-json',
        '--model',
        'modelo',
        '--trust',
      ],
    });
    expect(command.input).toStartWith('pergunta\n\nRegra de interação:');
  });

  test('interpreta mensagens JSON fragmentadas do Cursor', async () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk: '{"type":"system","subtype":"init","session_id":"chat-1"}\n',
      },
      {
        channel: 'stdout',
        chunk: '{"type":"assistant","message":{"content":[{"type":"text","text":"res',
      },
      { channel: 'stdout', chunk: 'posta"}]}}\n' },
      { channel: 'stderr', chunk: 'diagnóstico' },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'chat-1' },
      { type: 'output', value: 'resposta' },
      { type: 'output', value: 'diagnóstico' },
    ]);
  });

  test('classifica uma pergunta final como ask', async () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk:
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Qual é o seu nome?"}]}}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'ask', question: 'Qual é o seu nome?' },
    ]);
  });

  test('usa o resultado final quando não há mensagem de assistente', async () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk:
          '{"type":"result","subtype":"success","session_id":"chat-2","result":"pronto"}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'chat-2' },
      { type: 'output', value: 'pronto' },
    ]);
  });

  test('não duplica o resultado quando já emitiu o assistente', async () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk:
          '{"type":"assistant","session_id":"chat-3","message":{"content":[{"type":"text","text":"pronto"}]}}\n{"type":"result","session_id":"chat-3","result":"pronto"}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'chat-3' },
      { type: 'output', value: 'pronto' },
    ]);
  });

  test('permite forçar comandos quando configurado', () => {
    const provider = new CursorProvider({
      model: 'modelo',
      force: true,
    });

    expect(provider.createCommand('pergunta').arguments).toContain('--force');
  });

  test('cria um comando para retomar uma sessão', () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const command = provider.createCommand('dev', 'chat-123');

    expect(command.arguments).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--model',
      'modelo',
      '--trust',
      '--resume',
      'chat-123',
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
