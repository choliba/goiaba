import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, openLogger } from '../src/logger/index';
import type { ProgramOutput } from '../src/execute/types';
import type { AgentPolicy } from '../src/policy/index';
import { ClaudeProvider } from '../src/providers/claude/claude-provider';
import type { LiveTurn } from '../src/providers/types';

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
      executable: 'env',
      arguments: [
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
        'claude-custom',
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
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
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
      'claude',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      'modelo',
      '--permission-mode',
      'bypassPermissions',
      '--resume',
      'sessao-1',
    ]);
  });

  test('tools passa só as ferramentas escolhidas; [] não deixa nenhuma', () => {
    const some = new ClaudeProvider({
      model: 'modelo',
      tools: ['Read', 'Grep'],
    });
    const none = new ClaudeProvider({ model: 'modelo', tools: [] });

    expect(some.createCommand('oi').arguments).toEqual(
      expect.arrayContaining(['--tools', 'Read', 'Grep']),
    );
    const args = none.createCommand('oi').arguments ?? [];
    expect(args[args.indexOf('--tools') + 1]).toBe('');
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
    expect(args.slice(9, 13)).toEqual([
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

  test('em web, recusa só o que ficaria mais permissivo que a política', () => {
    // Stricter than the policy: applied (not granted, or denied wider).
    expect(
      apply({
        default: 'deny',
        allow: { web: [{ operations: ['*'], domains: ['bun.*'] }] },
      }),
    ).not.toThrow();
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
    ).not.toThrow();
    // Exact: the ignored domain is allowed by the other rule, as in Claude.
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
    ).not.toThrow();

    // Looser: a denial Claude cannot express would not be enforced.
    expect(
      apply({
        default: 'deny',
        deny: { web: [{ operations: ['*'], domains: ['evil.*'] }] },
      }),
    ).toThrow('O provider claude não aplica esta regra web');
    // Nobody answers an `ask` with --print.
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
      { type: 'stderr', text: 'diagnóstico' },
    ]);
  });

  test('o texto chega aos pedaços como partial, antes da mensagem', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const output = source([
      { channel: 'stdout', chunk: delta('thinking_delta', 'thinking', 'hm') },
      { channel: 'stdout', chunk: delta('text_delta', 'text', 'Olá, ') },
      { channel: 'stdout', chunk: delta('text_delta', 'text', 'mundo') },
      {
        channel: 'stdout',
        chunk:
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Olá, mundo"}]}}\n',
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'partial', text: 'Olá, ' },
      { type: 'partial', text: 'mundo' },
      { type: 'output', value: 'Olá, mundo' },
    ]);
  });

  test('o turno ao vivo mantém o stdin aberto e fecha quando tudo foi respondido', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const turn = provider.openLiveTurn('primeira', 'sessao-1');
    const args = turn.command.arguments ?? [];

    expect(args).toEqual(
      expect.arrayContaining(['--input-format', 'stream-json']),
    );
    expect(args).toEqual(expect.arrayContaining(['--resume', 'sessao-1']));
    expect(turn.command.input).toBeUndefined();
    expect(turn.send('segunda')).toBe(true);
    expect(turn.send('terceira')).toBe(true);

    // The CLI answers each message with a result; the last one closes stdin.
    const result = '{"type":"result","result":"ok"}\n';
    const answers = collect(
      provider.parseOutput(
        source([
          { channel: 'stdout', chunk: result },
          { channel: 'stdout', chunk: result },
          { channel: 'stdout', chunk: result },
        ]),
      ),
    );
    const sent = await collect(stdinOf(turn));
    await answers;

    expect(sent.map((line) => readUserMessage(line))).toEqual([
      'primeira',
      'segunda',
      'terceira',
    ]);
    expect(turn.send('tarde demais')).toBe(false);
  });

  test('o turno ao vivo fechado antes das respostas (falha, Ctrl+C) não aceita mais nada', async () => {
    const turn = new ClaudeProvider({ model: 'modelo' }).openLiveTurn('oi');
    turn.close();

    expect(turn.send('depois')).toBe(false);
    expect(await collect(stdinOf(turn))).toHaveLength(1);
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

  test('entrega os tokens uma vez por mensagem, com as ferramentas, e o custo do resultado', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const usage = {
      input_tokens: 2,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 900,
      output_tokens: 50,
      output_tokens_details: { thinking_tokens: 20 },
    };
    // The CLI repeats a message's usage in every block of it (same id).
    const lines = [
      {
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'thinking', thinking: '…' }],
          usage,
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'm1',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
          usage,
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'a.txt' },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'm2',
          content: [{ type: 'text', text: 'feito' }],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      },
      {
        type: 'result',
        session_id: 's1',
        result: 'feito',
        total_cost_usd: 0.25,
      },
    ];
    const events = await collect(
      provider.parseOutput(
        source([
          {
            channel: 'stdout',
            chunk: lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
          },
        ]),
      ),
    );

    expect(
      events.filter((event) => event.type === 'usage' || event.type === 'cost'),
    ).toEqual([
      {
        type: 'usage',
        usage: {
          input: 1002,
          output: 50,
          cachedInput: 900,
          cacheWrite: 100,
          reasoning: 20,
        },
        action: 'Bash',
      },
      {
        type: 'usage',
        usage: { input: 5, output: 3, cachedInput: 0, cacheWrite: 0 },
      },
      { type: 'cost', usd: 0.25 },
    ]);
  });

  test('num turno ao vivo, cada resultado entrega só o custo que ainda não tinha informado', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const lines = [
      { type: 'result', session_id: 's1', result: 'um', total_cost_usd: 0.1 },
      {
        type: 'result',
        session_id: 's1',
        result: 'dois',
        total_cost_usd: 0.25,
      },
    ];
    const events = await collect(
      provider.parseOutput(
        source([
          {
            channel: 'stdout',
            chunk: lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
          },
        ]),
      ),
    );

    expect(events.filter((event) => event.type === 'cost')).toEqual([
      { type: 'cost', usd: 0.1 },
      { type: 'cost', usd: 0.15 },
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

  test('um resultado de erro não abre sessão: --resume de uma conversa que a CLI não tem mais', async () => {
    const provider = new ClaudeProvider({ model: 'modelo' });
    const missing = 'No conversation found with session ID: sessao-velha';
    const output = source([
      { channel: 'stderr', chunk: `${missing}\n` },
      {
        channel: 'stdout',
        chunk: `${JSON.stringify({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          num_turns: 0,
          session_id: 'sessao-velha',
          errors: [missing],
        })}\n`,
      },
    ]);

    const events = await collect(provider.parseOutput(output));
    expect(events).not.toContainEqual({ type: 'session', id: 'sessao-velha' });
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

/** What a live turn writes to the CLI's stdin. */
function stdinOf(turn: LiveTurn): AsyncIterable<string> {
  if (turn.command.inputStream === undefined) {
    throw new Error('o turno ao vivo não tem stdin em stream');
  }
  return turn.command.inputStream;
}

/** The text of a stream-json user message, without the interaction rules. */
function readUserMessage(line: string): string {
  const parsed: unknown = JSON.parse(line);
  const message =
    typeof parsed === 'object' && parsed !== null && 'message' in parsed
      ? parsed.message
      : undefined;
  const content =
    typeof message === 'object' && message !== null && 'content' in message
      ? message.content
      : undefined;
  return typeof content === 'string' ? (content.split('\n\n')[0] ?? '') : '';
}

/** A `stream_event` line with one `content_block_delta`. */
function delta(type: string, field: string, value: string): string {
  const event = {
    type: 'content_block_delta',
    delta: { type, [field]: value },
  };
  return `${JSON.stringify({ type: 'stream_event', event })}\n`;
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
