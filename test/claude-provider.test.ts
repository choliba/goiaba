import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index.js';
import { closeLogger, openLogger } from '../src/log/index.js';
import type { ProgramOutput } from '../src/execute/types.js';
import { ClaudeProvider } from '../src/providers/claude-provider.js';
import { readLogRecords } from './support/log-records.js';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

describe('ClaudeProvider', () => {
  test('descreve o comando sem executá-lo', () => {
    const provider = new ClaudeProvider({
      executable: 'claude-custom',
      model: 'modelo',
    });

    const command = provider.createCommand('pergunta');

    expect(command).toMatchObject({
      executable: 'claude-custom',
      arguments: [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        'modelo',
        '--permission-mode',
        'bypassPermissions',
      ],
    });
    expect(command.input).toStartWith('pergunta\n\nRegra de interação:');
  });

  test('sem permissões de execution deixa a sandbox como limite', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });

    expect(provider.createCommand('dev', 'sessao-1').arguments).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'modelo',
      '--permission-mode',
      'bypassPermissions',
      '--resume',
      'sessao-1',
    ]);
  });

  test('traduz permissions.execution para settings do claude', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions({
      default: 'deny',
      allow: {
        filesystem: [
          { operations: ['read', 'write'], paths: ['/workspace/**'] },
        ],
        execution: [
          {
            commands: ['bun *', 'git status'],
            ignores: { commands: ['bun publish**'] },
          },
        ],
      },
      deny: { execution: [{ commands: ['sudo *'] }] },
    });

    const args = provider.createCommand('pergunta').arguments ?? [];

    expect(args.slice(6, 10)).toEqual([
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      '',
    ]);
    expect(JSON.parse(args[args.indexOf('--settings') + 1] ?? '')).toEqual({
      permissions: {
        allow: [
          'Read',
          'Edit',
          'Write',
          'Glob',
          'Grep',
          'NotebookEdit',
          'Bash(bun *)',
          'Bash(git status)',
        ],
        deny: ['Bash(bun publish*)', 'Bash(sudo *)'],
      },
    });
  });

  test('sem execution não altera o comando', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions({
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
      },
    });

    expect(provider.createCommand('pergunta').arguments).not.toContain(
      '--settings',
    );
    expect(provider.createCommand('pergunta').arguments).toContain(
      'bypassPermissions',
    );
  });

  test('recusa o que não tem tradução exata', () => {
    const execution = { commands: ['bun *'] };

    expect(
      apply({
        default: 'deny',
        allow: { web: [{ operations: ['search'], domains: ['*'] }] },
      }),
    ).toThrow('categoria web');
    expect(
      apply({
        default: 'deny',
        requireApproval: { execution: [execution] },
      }),
    ).toThrow('aprovação');
    expect(
      apply({
        default: 'deny',
        allow: { execution: [{ commands: ['bun [a-z]*'] }] },
      }),
    ).toThrow('não tem equivalente');
    expect(
      apply({
        default: 'deny',
        deny: {
          execution: [
            { commands: ['rm *'], ignores: { commands: ['rm tmp'] } },
          ],
        },
      }),
    ).toThrow('ignores');
  });

  test('interpreta mensagens JSON fragmentadas do Claude', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk: '{"type":"system","subtype":"init","session_id":"sessao-1"}\n',
      },
      {
        channel: 'stdout',
        chunk:
          '{"type":"assistant","session_id":"sessao-1","message":{"content":[{"type":"text","text":"res',
      },
      { channel: 'stdout', chunk: 'posta"}]}}\n' },
      {
        channel: 'stdout',
        chunk:
          '{"type":"result","session_id":"sessao-1","result":"resposta"}\n',
      },
      { channel: 'stderr', chunk: 'diagnóstico' },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'sessao-1' },
      { type: 'output', value: 'resposta' },
      { type: 'output', value: 'diagnóstico' },
    ]);
  });

  test('classifica uma pergunta final como ask', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
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
    const provider = new ClaudeProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk: '{"type":"result","session_id":"sessao-2","result":"pronto"}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'sessao-2' },
      { type: 'output', value: 'pronto' },
    ]);
  });

  test('registra o erro de uma ferramenta em logDir/erros, mesmo sem debug', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logDir: 'logs', debug: false };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new ClaudeProvider({ model: 'modelo' });
      await collect(
        provider.parseOutput(
          source([
            {
              channel: 'stdout',
              chunk: `${JSON.stringify({
                type: 'assistant',
                message: {
                  content: [
                    {
                      type: 'tool_use',
                      id: 'tool-1',
                      name: 'Bash',
                      input: { command: 'npm create vite@latest' },
                    },
                  ],
                },
              })}\n${JSON.stringify({
                type: 'user',
                message: {
                  content: [
                    {
                      type: 'tool_result',
                      tool_use_id: 'tool-1',
                      is_error: true,
                      content: [
                        { type: 'text', text: 'EROFS: read-only file system' },
                      ],
                    },
                  ],
                },
              })}\n`,
            },
          ]),
        ),
      );

      const error = {
        level: 'error',
        type: 'tool_error',
        provider: 'claude',
        call_id: 'tool-1',
        tool: 'Bash',
        args: { command: 'npm create vite@latest' },
        message: 'EROFS: read-only file system',
      };

      // debug: false drops the tool_use record but keeps the error.
      expect(readLogRecords(join(cwd, 'logs'))).toEqual([
        expect.objectContaining(error),
      ]);
      expect(readLogRecords(join(cwd, 'logs', 'erros'))).toEqual([
        expect.objectContaining(error),
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('debug registra tool_use sem o conteúdo dos arquivos', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logDir: 'logs', debug: true };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new ClaudeProvider({ model: 'modelo' });
      await collect(
        provider.parseOutput(
          source([
            {
              channel: 'stdout',
              chunk: `${JSON.stringify({
                type: 'assistant',
                message: {
                  content: [
                    {
                      type: 'tool_use',
                      id: 'tool-1',
                      name: 'Write',
                      input: {
                        file_path: '/tmp/a.txt',
                        content: 'secret-content',
                      },
                    },
                  ],
                },
              })}\n`,
            },
          ]),
        ),
      );

      const records = readLogRecords(join(cwd, 'logs'));

      expect(records).toEqual([
        expect.objectContaining({
          level: 'debug',
          type: 'tool',
          call_id: 'tool-1',
          tool: 'Write',
          args: { file_path: '/tmp/a.txt', content: { bytes: 14 } },
        }),
      ]);
      expect(JSON.stringify(records)).not.toContain('secret-content');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

function apply(
  permissions: Parameters<ClaudeProvider['applyPermissions']>[0],
): () => void {
  return () => {
    new ClaudeProvider({ model: 'modelo' }).applyPermissions(permissions);
  };
}

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
