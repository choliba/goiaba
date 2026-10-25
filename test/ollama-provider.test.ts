import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import type { ProgramOutput } from '../src/execute/types.js';
import { OllamaProvider } from '../src/providers/ollama-provider.js';

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

  test('o claude traduz permissions.execution como o ClaudeProvider', () => {
    const provider = new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' });
    provider.applyPermissions?.({
      default: 'deny',
      allow: { execution: [{ commands: ['bun *'] }] },
    });

    const args = provider.createCommand('pergunta').arguments ?? [];

    expect(args).toContain('dontAsk');
    expect(args[args.indexOf('--settings') + 1]).toContain('Bash(bun *)');
  });

  test('roda o codex em modo --oss, em turno novo e no resume', () => {
    const provider = new OllamaProvider({
      cli: 'codex',
      model: 'qwen3.5:4b',
      baseUrl: 'http://gpu.local:11434/',
    });

    expect(provider.id).toBe('ollama-codex');
    expect(provider.applyPermissions).toBeFunction();
    expect(provider.createCommand('pergunta').arguments).toEqual([
      'CODEX_OSS_BASE_URL=http://gpu.local:11434/v1',
      'codex',
      'exec',
      '--oss',
      '--local-provider',
      'ollama',
      '--dangerously-bypass-hook-trust',
      '--disable',
      'apps',
      '--disable',
      'goals',
      '--sandbox',
      'danger-full-access',
      '--color',
      'never',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'qwen3.5:4b',
      '-',
    ]);
    expect(provider.createCommand('resposta', 'thread-1').arguments).toEqual([
      'CODEX_OSS_BASE_URL=http://gpu.local:11434/v1',
      'codex',
      'exec',
      '--oss',
      '--local-provider',
      'ollama',
      '--dangerously-bypass-hook-trust',
      '--disable',
      'apps',
      '--disable',
      'goals',
      '--sandbox',
      'danger-full-access',
      '--color',
      'never',
      'resume',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'qwen3.5:4b',
      'thread-1',
      '-',
    ]);
  });

  test('o codex traduz permissions.execution para exec policy isolada', () => {
    const provider = new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' });

    try {
      provider.applyPermissions?.({
        default: 'deny',
        allow: {
          execution: [
            {
              commands: ['bun *', 'npm *'],
              ignores: { commands: ['npm publish', 'npm publish *'] },
            },
          ],
        },
        deny: { execution: [{ commands: ['sudo *'] }] },
      });

      const args = provider.createCommand('pergunta').arguments ?? [];
      const homeEntry = args.find((arg) => arg.startsWith('CODEX_HOME='));
      expect(homeEntry).toBeDefined();
      const home = homeEntry?.slice('CODEX_HOME='.length) ?? '';
      const rules = readFileSync(`${home}/rules/goiaba.rules`, 'utf8');
      const hook = readFileSync(`${home}/execution-policy.mjs`, 'utf8');
      const hooks = readFileSync(`${home}/hooks.json`, 'utf8');

      expect(rules).toContain('pattern=["bun"], decision="allow"');
      expect(rules).toContain('pattern=["npm"], decision="allow"');
      expect(rules).toContain(
        'pattern=["npm","publish"], decision="forbidden"',
      );
      expect(rules).toContain('pattern=["sudo"], decision="forbidden"');
      expect(hook).toContain('Comando não autorizado');
      expect(hook).toContain('"bun *"');
      expect(hooks).toContain('PreToolUse');
      expect(hooks).toContain('^Bash$');

      provider.close();
      expect(existsSync(home)).toBe(false);
    } finally {
      provider.close();
    }
  });

  test('o codex recusa padrão de execution sem equivalente seguro', () => {
    const provider = new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' });

    try {
      expect(() =>
        provider.applyPermissions?.({
          default: 'deny',
          allow: { execution: [{ commands: ['npm publish*'] }] },
        }),
      ).toThrow('não tem equivalente no codex');
    } finally {
      provider.close();
    }
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
