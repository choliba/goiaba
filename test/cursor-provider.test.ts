import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, openLogger } from '../src/logger/index';
import type { ProgramOutput } from '../src/execute/types';
import { CursorProvider } from '../src/providers/cursor-provider';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

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
        '--force',
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
        chunk:
          '{"type":"assistant","message":{"content":[{"type":"text","text":"res',
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
      '--force',
      '--resume',
      'chat-123',
    ]);
  });

  test('entrega tool calls de shell sem stdout', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logger: { dir: 'logs' }, debug: true };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new CursorProvider({ model: 'modelo' });
      const events = await collect(
        provider.parseOutput(
          source([
            {
              channel: 'stdout',
              chunk: `${JSON.stringify({
                type: 'tool_call',
                subtype: 'completed',
                call_id: 'tool-1',
                tool_call: {
                  shellToolCall: {
                    args: {
                      command: 'ping -c 1 google.com',
                      workingDirectory: cwd,
                    },
                    result: {
                      success: {
                        exitCode: 0,
                        stdout: 'secret-output',
                        stderr: '',
                      },
                    },
                  },
                },
              })}\n`,
            },
          ]),
        ),
      );

      expect(events).toEqual([
        {
          type: 'tool',
          phase: 'call',
          detail: expect.objectContaining({
            subtype: 'completed',
            call_id: 'tool-1',
            tool: 'shell',
            args: {
              command: 'ping -c 1 google.com',
              workingDirectory: cwd,
            },
          }),
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('secret-output');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('informa o workspace para o --trust não cair na raiz', () => {
    const provider = new CursorProvider({ model: 'modelo' });
    const command = provider.createCommand(
      'pergunta',
      undefined,
      '/home/dev/dev/sandbox-teste',
    );

    expect(command.arguments).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--model',
      'modelo',
      '--workspace',
      '/home/dev/dev/sandbox-teste',
      '--trust',
      '--force',
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
