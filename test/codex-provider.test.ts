import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index.js';
import { closeLogger, openLogger } from '../src/log/index.js';
import { CodexProvider } from '../src/providers/codex-provider.js';
import type { ProgramOutput } from '../src/execute/types.js';
import { readLogRecords } from './support/log-records.js';

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

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
        'exec',
        '--sandbox',
        'danger-full-access',
        '--color',
        'never',
        '--skip-git-repo-check',
        '--json',
        '--model',
        'modelo',
        '-',
      ],
    });
    expect(command.input).toStartWith('pergunta\n\nRegra de interação:');
    expect(command.input).toContain(
      'Nunca chame a ferramenta request_user_input.',
    );
  });

  test('registra um comando que falhou em logDir/erros', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logDir: 'logs' };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new CodexProvider({ model: 'modelo' });
      const item = (exitCode: number, output: string): string =>
        `${JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'npm install',
            cwd,
            exit_code: exitCode,
            aggregated_output: output,
          },
        })}\n`;

      await collect(
        provider.parseOutput(
          source([
            { channel: 'stdout', chunk: item(0, 'ok') },
            { channel: 'stdout', chunk: item(1, 'npm ERR! EROFS') },
          ]),
        ),
      );

      expect(readLogRecords(join(cwd, 'logs', 'erros'))).toEqual([
        expect.objectContaining({
          level: 'error',
          type: 'tool_error',
          provider: 'codex',
          command: 'npm install',
          exitCode: 1,
          message: 'npm ERR! EROFS',
        }),
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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

  test('cria um comando para retomar uma sessão', () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const command = provider.createCommand('dev', 'thread-123');

    expect(command.arguments).toEqual([
      'exec',
      '--sandbox',
      'danger-full-access',
      '--color',
      'never',
      'resume',
      '--skip-git-repo-check',
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
