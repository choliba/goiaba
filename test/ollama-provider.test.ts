import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { ProgramOutput } from '../src/execute/types';
import { OllamaProvider } from '../src/providers/ollama-provider';

describe('OllamaProvider', () => {
  test('aponta o claude para o Ollama por variáveis de ambiente', () => {
    const provider = new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' });
    const command = provider.createCommand('pergunta');

    expect(provider.id).toBe('ollama-claude');
    expect(command.executable).toBe('env');
    expect(command.arguments).toEqual([
      'ANTHROPIC_BASE_URL=http://127.0.0.1:11434',
      'ANTHROPIC_AUTH_TOKEN=ollama',
      'ANTHROPIC_API_KEY=',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen3.5:4b',
      'ANTHROPIC_DEFAULT_SONNET_MODEL=qwen3.5:4b',
      'ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3.5:4b',
      'CLAUDE_CODE_SUBAGENT_MODEL=qwen3.5:4b',
      'CLAUDE_CODE_MAX_CONTEXT_TOKENS=32768',
      'CLAUDE_CODE_AUTO_COMPACT_WINDOW=32768',
      'env',
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
      'claude',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'qwen3.5:4b',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(command.input).toStartWith('pergunta\n\nRegra de interação:');
  });

  test('o claude usa o gate como o ClaudeProvider', () => {
    const provider = new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' });
    provider.applyPermissions(
      { default: 'deny', allow: { execution: [{ commands: ['bun *'] }] } },
      {
        hookCommand: ['/bin/bun', '/gate/hook', '/gate/s.sock'],
        root: '/w',
      },
    );

    const args = provider.createCommand('pergunta').arguments ?? [];

    expect(args).toContain('dontAsk');
    expect(args[args.indexOf('--settings') + 1]).toContain('/gate/hook');
  });

  test('roda o codex em modo --oss, em turno novo e no resume', () => {
    const provider = new OllamaProvider({
      cli: 'codex',
      model: 'qwen3.5:4b',
      baseUrl: 'http://gpu.local:11434/',
    });

    expect(provider.id).toBe('ollama-codex');
    expect(provider.createCommand('pergunta').arguments).toEqual([
      'CODEX_OSS_BASE_URL=http://gpu.local:11434/v1',
      'RUST_LOG=error,codex_models_manager=off',
      'codex',
      'exec',
      '--oss',
      '--local-provider',
      'ollama',
      '--disable',
      'apps',
      '--disable',
      'goals',
      '-c',
      'model_context_window=32768',
      '-c',
      'model_auto_compact_token_limit=26214',
      '--dangerously-bypass-approvals-and-sandbox',
      '--color',
      'never',
      '-c',
      'analytics.enabled=false',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'qwen3.5:4b',
      '-',
    ]);
    expect(provider.createCommand('resposta', 'thread-1').arguments).toEqual([
      'CODEX_OSS_BASE_URL=http://gpu.local:11434/v1',
      'RUST_LOG=error,codex_models_manager=off',
      'codex',
      'exec',
      '--oss',
      '--local-provider',
      'ollama',
      '--disable',
      'apps',
      '--disable',
      'goals',
      '-c',
      'model_context_window=32768',
      '-c',
      'model_auto_compact_token_limit=26214',
      '--dangerously-bypass-approvals-and-sandbox',
      '--color',
      'never',
      '-c',
      'analytics.enabled=false',
      'resume',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'qwen3.5:4b',
      'thread-1',
      '-',
    ]);
  });

  test('o codex liga o hook do gate num CODEX_HOME do workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-ollama-'));
    const cache = mkdtempSync(join(tmpdir(), 'goiaba-cache-'));
    const previous = process.env['XDG_CACHE_HOME'];
    process.env['XDG_CACHE_HOME'] = cache;

    try {
      const provider = new OllamaProvider({
        cli: 'codex',
        model: 'qwen3.5:4b',
      });
      const protectedFiles = provider.applyPermissions(
        { default: 'deny', allow: { execution: [{ commands: ['bun *'] }] } },
        { hookCommand: ['/bin/bun', '/gate/hook', '/gate/s.sock'], root },
      );
      const args = provider.createCommand('pergunta').arguments ?? [];
      const home = (
        args.find((arg) => arg.startsWith('CODEX_HOME=')) ?? ''
      ).slice('CODEX_HOME='.length);

      expect(home.startsWith(join(cache, 'goiaba', 'codex'))).toBe(true);
      expect(args).toContain('--dangerously-bypass-hook-trust');
      expect(args.indexOf('--oss')).toBe(args.indexOf('exec') + 1);
      expect(protectedFiles).toEqual([
        join(home, 'hooks.json'),
        join(home, 'rules'),
      ]);
      expect(
        JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8')),
      ).toEqual({
        hooks: {
          PreToolUse: [
            {
              matcher: '^Bash$',
              hooks: [
                {
                  type: 'command',
                  command: `'/bin/bun' '/gate/hook' '/gate/s.sock'`,
                  timeout: 3600,
                },
              ],
            },
          ],
        },
      });
      // The same workspace keeps the same CODEX_HOME, so sessions survive.
      const again = new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' });
      again.applyPermissions(
        { default: 'deny', allow: { execution: [{ commands: ['bun *'] }] } },
        { hookCommand: ['/bin/bun', '/gate/hook', '/gate/s.sock'], root },
      );
      expect(again.createCommand('pergunta').arguments).toContain(
        `CODEX_HOME=${home}`,
      );
    } finally {
      if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
      else process.env['XDG_CACHE_HOME'] = previous;
      rmSync(root, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    }
  });

  test('o codex no Ollama recusa a busca hospedada', () => {
    const provider = new OllamaProvider({
      cli: 'codex',
      model: 'qwen3.5:4b',
    });

    expect(() =>
      provider.applyPermissions(
        {
          default: 'deny',
          allow: { web: [{ operations: ['*'], domains: ['*'] }] },
        },
        undefined,
      ),
    ).toThrow('O Ollama não oferece a ferramenta web_search hospedada');
  });

  test('tira da saída os avisos que só existem por causa do Ollama', async () => {
    const provider = new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' });
    const output = (async function* (): AsyncIterable<ProgramOutput> {
      yield {
        channel: 'stderr',
        chunk:
          '[claude-code:unrecognized_model] {"model":"qwen3.5:4b"}\n' +
          '⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set\n',
      };
      yield { channel: 'stderr', chunk: 'erro de verdade\n' };
      yield {
        channel: 'stdout',
        chunk:
          '{"type":"assistant","message":{"content":[{"type":"text","text":"oi"}]}}\n',
      };
    })();
    const events = [];

    for await (const event of provider.parseOutput(output)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'output', value: 'erro de verdade\n' },
      { type: 'output', value: 'oi' },
    ]);
  });

  test('o contexto real chega às duas CLIs', () => {
    const claude = new OllamaProvider({
      cli: 'claude',
      model: 'qwen3.5:4b',
      contextWindow: 16_384,
    }).createCommand('oi');
    const codex = new OllamaProvider({
      cli: 'codex',
      model: 'qwen3.5:4b',
      contextWindow: 16_384,
    }).createCommand('oi');

    expect(claude.arguments).toEqual(
      expect.arrayContaining([
        'CLAUDE_CODE_MAX_CONTEXT_TOKENS=16384',
        'CLAUDE_CODE_AUTO_COMPACT_WINDOW=16384',
      ]),
    );
    expect(codex.arguments).toEqual(
      expect.arrayContaining([
        'model_context_window=16384',
        'model_auto_compact_token_limit=13107',
      ]),
    );
    expect(
      () => new OllamaProvider({ cli: 'codex', model: 'm', contextWindow: 0 }),
    ).toThrow('contextWindow');
  });

  test('recusa uma baseUrl inválida', () => {
    expect(
      () =>
        new OllamaProvider({
          cli: 'codex',
          model: 'qwen3.5:4b',
          baseUrl: 'localhost',
        }),
    ).toThrow('baseUrl do Ollama inválida: localhost');
  });
});
