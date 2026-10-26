import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, openLogger } from '../src/logger/index';
import type { ProgramOutput } from '../src/execute/types';
import type { AgentPolicy } from '../src/policy/index';
import { ClaudeProvider } from '../src/providers/claude/claude-provider';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

function apply(permissions: AgentPolicy): () => readonly string[] {
  return () =>
    new ClaudeProvider({ model: 'modelo' }).applyPermissions(
      permissions,
      undefined,
    );
}

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

  test('com execution liga o hook do gate e roda em dontAsk', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const protectedFiles = provider.applyPermissions(
      {
        default: 'deny',
        allow: { execution: [{ commands: ['bun *'] }] },
      },
      {
        hookCommand: ['/bin/bun', "/gate/hook's", '/gate/s.sock'],
        root: '/w',
      },
    );

    const args = provider.createCommand('pergunta').arguments ?? [];

    expect(protectedFiles).toEqual([]);
    expect(args.slice(6, 10)).toEqual([
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      '',
    ]);
    expect(JSON.parse(args[args.indexOf('--settings') + 1] ?? '')).toEqual({
      permissions: {
        allow: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'],
        deny: [],
      },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: `'/bin/bun' '/gate/hook'\\''s' '/gate/s.sock'`,
                timeout: 3600,
                onFailure: 'block',
              },
            ],
          },
        ],
      },
    });
  });

  test('sem execution não altera o comando', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions(
      {
        default: 'deny',
        allow: {
          filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
        },
      },
      undefined,
    );

    expect(provider.createCommand('pergunta').arguments).not.toContain(
      '--settings',
    );
    expect(provider.createCommand('pergunta').arguments).toContain(
      'bypassPermissions',
    );
  });

  test('recusa categoria que não aplica', () => {
    expect(() =>
      new ClaudeProvider({ model: 'modelo' }).applyPermissions(
        {
          default: 'deny',
          allow: {
            communication: [{ operations: ['send_email'], channels: ['*'] }],
          },
        },
        undefined,
      ),
    ).toThrow('categoria communication');
  });

  test('traduz web em regras de WebFetch e WebSearch', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions(
      {
        default: 'deny',
        allow: {
          web: [
            { operations: ['*'], domains: ['*'] },
            { operations: ['read_text', 'search'], domains: ['bun.sh'] },
          ],
        },
        deny: { web: [{ operations: ['*'], domains: ['evil.com'] }] },
      },
      undefined,
    );

    const args = provider.createCommand('pergunta').arguments ?? [];

    expect(args).toContain('dontAsk');
    expect(JSON.parse(args[args.indexOf('--settings') + 1] ?? '')).toEqual({
      permissions: {
        allow: [
          'Read',
          'Edit',
          'Write',
          'Glob',
          'Grep',
          'NotebookEdit',
          'Bash',
          'WebFetch',
          'WebSearch',
          'WebFetch(domain:bun.sh)',
        ],
        deny: ['WebFetch(domain:evil.com)', 'WebSearch'],
      },
    });
  });

  test('ignores de web viram negações, sem WebSearch', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions(
      {
        default: 'deny',
        allow: {
          web: [
            {
              operations: ['*'],
              domains: ['*'],
              ignores: { domains: ['google.com'] },
            },
          ],
        },
      },
      undefined,
    );

    const args = provider.createCommand('pergunta').arguments ?? [];
    const settings: unknown = JSON.parse(
      args[args.indexOf('--settings') + 1] ?? '',
    );

    expect(settings).toMatchObject({
      permissions: {
        allow: expect.arrayContaining(['WebFetch']),
        deny: ['WebFetch(domain:google.com)'],
      },
    });
    // A search cannot leave google.com out, so it is not allowed.
    expect(JSON.stringify(settings)).not.toContain('WebSearch');
  });

  test('*.dominio vira a mesma regra de subdomínios no Claude', () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    provider.applyPermissions(
      {
        default: 'deny',
        allow: {
          web: [
            {
              operations: ['read_text'],
              domains: ['*'],
              ignores: { domains: ['google.com', '*.google.com'] },
            },
          ],
        },
      },
      undefined,
    );

    const args = provider.createCommand('pergunta').arguments ?? [];
    expect(
      JSON.parse(args[args.indexOf('--settings') + 1] ?? ''),
    ).toMatchObject({
      permissions: {
        deny: ['WebFetch(domain:google.com)', 'WebFetch(domain:*.google.com)'],
      },
    });
  });

  test('recusa em web o que o Claude não aplica exatamente', () => {
    expect(
      apply({
        default: 'deny',
        allow: { web: [{ operations: ['*'], domains: ['bun.*'] }] },
      }),
    ).toThrow('domínios exatos, "*.dominio" ou "*"');
    expect(
      apply({
        default: 'deny',
        allow: {
          web: [
            {
              operations: ['*'],
              domains: ['*'],
              ignores: { domains: ['evil.com'] },
            },
            { operations: ['read_text'], domains: ['evil.com'] },
          ],
        },
      }),
    ).toThrow('outra regra web o libera');
    expect(
      apply({
        default: 'deny',
        deny: {
          web: [
            {
              operations: ['*'],
              domains: ['*'],
              ignores: { domains: ['bun.sh'] },
            },
          ],
        },
      }),
    ).toThrow('ignores em deny.web');
    expect(
      apply({
        default: 'deny',
        requireApproval: { web: [{ operations: ['*'], domains: ['*'] }] },
      }),
    ).toThrow('requireApproval em web');
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

  test('entrega a chamada e o erro de uma ferramenta como eventos', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logger: { dir: 'logs' }, debug: false };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new ClaudeProvider({ model: 'modelo' });
      const events = await collect(
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

      // The agent logs them (tool_error at level error, even without debug).
      expect(events).toEqual([
        {
          type: 'tool',
          phase: 'call',
          detail: {
            call_id: 'tool-1',
            tool: 'Bash',
            args: { command: 'npm create vite@latest' },
          },
        },
        {
          type: 'tool',
          phase: 'error',
          detail: {
            provider: 'claude',
            call_id: 'tool-1',
            tool: 'Bash',
            args: { command: 'npm create vite@latest' },
            message: 'EROFS: read-only file system',
          },
        },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('entrega tool_use sem o conteúdo dos arquivos', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logger: { dir: 'logs' }, debug: true };\n`,
      );
      await loadConfig({ cwd });
      openLogger();

      const provider = new ClaudeProvider({ model: 'modelo' });
      const events = await collect(
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

      expect(events).toEqual([
        {
          type: 'tool',
          phase: 'call',
          detail: {
            call_id: 'tool-1',
            tool: 'Write',
            args: { file_path: '/tmp/a.txt', content: { bytes: 14 } },
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('secret-content');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
