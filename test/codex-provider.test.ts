import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, openLogger } from '../src/logger/index';
import { CodexProvider } from '../src/providers/codex/codex-provider';
import type { ProgramOutput } from '../src/execute/types';

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
        '--dangerously-bypass-approvals-and-sandbox',
        '--color',
        'never',
        '-c',
        'analytics.enabled=false',
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

  test('share com gate usa um CODEX_HOME próprio, ligado ao estado do host', () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const base = mkdtempSync(join(tmpdir(), 'goiaba-codex-share-'));
    const hostHome = join(base, 'host');
    const home = join(base, 'workspace-home');
    mkdirSync(join(hostHome, '.codex', 'sessions'), { recursive: true });
    mkdirSync(join(hostHome, '.codex', 'rules'), { recursive: true });
    writeFileSync(join(hostHome, '.codex', 'auth.json'), 'login');
    writeFileSync(join(hostHome, '.codex', 'hooks.json'), 'hook-do-usuario');

    try {
      provider.applyPermissions(
        { default: 'deny' },
        {
          hookCommand: ['/bun', '/gate/hook', '/gate.sock'],
          root: '/workspace',
          home,
          sharedHome: hostHome,
        },
      );
      const own = join(home, '.codex-share');

      expect(provider.createCommand('pergunta')).toMatchObject({
        executable: 'env',
        arguments: expect.arrayContaining([`CODEX_HOME=${own}`]),
      });
      // O estado do host por links; o hook e as regras são nossos.
      expect(readlinkSync(join(own, 'auth.json'))).toBe(
        join(hostHome, '.codex', 'auth.json'),
      );
      expect(readlinkSync(join(own, 'sessions'))).toBe(
        join(hostHome, '.codex', 'sessions'),
      );
      expect(lstatSync(join(own, 'hooks.json')).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(own, 'rules')).isSymbolicLink()).toBe(false);
      // Nada do Goiaba no ~/.codex do host.
      expect(readFileSync(join(hostHome, '.codex', 'hooks.json'), 'utf8')).toBe(
        'hook-do-usuario',
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test('entrega a falha de um comando como evento de ferramenta', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `export default { logger: { dir: 'logs' } };\n`,
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

      const events = await collect(
        provider.parseOutput(
          source([
            { channel: 'stdout', chunk: item(0, 'ok') },
            { channel: 'stdout', chunk: item(1, 'npm ERR! EROFS') },
          ]),
        ),
      );

      expect(events.filter((event) => event.type === 'tool')).toEqual([
        expect.objectContaining({ phase: 'call' }),
        expect.objectContaining({ phase: 'call' }),
        {
          type: 'tool',
          phase: 'error',
          detail: expect.objectContaining({
            provider: 'codex',
            command: 'npm install',
            exitCode: 1,
            message: 'npm ERR! EROFS',
          }),
        },
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

  test('as negações do gate no stderr não chegam à saída', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const denial =
      '2026-10-26T16:21:38Z ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: Negado: este comando aguarda a aprovação. Command: ls';
    const output = source([
      { channel: 'stderr', chunk: `${denial}\n` },
      { channel: 'stderr', chunk: `${denial}\nfalha de verdade\n` },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'output', value: 'falha de verdade\n' },
    ]);
  });

  test('usa o último reasoning quando o modelo local não envia resposta', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      { channel: 'stdout', chunk: '{"type":"turn.started"}\n' },
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"reasoning","text":"vou usar curl"}}\n',
      },
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"command_execution","command":"curl https://example.com","exit_code":0}}\n',
      },
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"reasoning","text":"conteúdo final"}}\n',
      },
      { channel: 'stdout', chunk: '{"type":"turn.completed"}\n' },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'reasoning', text: 'vou usar curl' },
      expect.objectContaining({ type: 'tool', phase: 'call' }),
      { type: 'output', value: '✓ curl https://example.com' },
      { type: 'reasoning', text: 'conteúdo final' },
      { type: 'output', value: 'conteúdo final' },
    ]);
  });

  test('o reasoning chega antes, e não vira resposta quando existe agent_message', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      { channel: 'stdout', chunk: '{"type":"turn.started"}\n' },
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"reasoning","text":"rascunho"}}\n',
      },
      {
        channel: 'stdout',
        chunk:
          '{"type":"item.completed","item":{"type":"agent_message","text":"resposta"}}\n',
      },
      { channel: 'stdout', chunk: '{"type":"turn.completed"}\n' },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'reasoning', text: 'rascunho' },
      { type: 'output', value: 'resposta' },
    ]);
  });

  test('mostra por que o turno falhou, uma vez só', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const message = 'You’ve hit your usage limit.';
    const output = source([
      {
        channel: 'stdout',
        chunk: '{"type":"thread.started","thread_id":"sessao"}\n',
      },
      { channel: 'stdout', chunk: '{"type":"turn.started"}\n' },
      {
        channel: 'stdout',
        chunk: `${JSON.stringify({ type: 'error', message })}\n`,
      },
      {
        channel: 'stdout',
        chunk: `${JSON.stringify({ type: 'turn.failed', error: { message } })}\n`,
      },
    ]);

    expect(await collect(provider.parseOutput(output))).toEqual([
      { type: 'session', id: 'sessao' },
      { type: 'output', value: message },
    ]);
  });

  test('mostra o progresso dos comandos no terminal', async () => {
    const provider = new CodexProvider({ model: 'modelo' });
    const output = source([
      {
        channel: 'stdout',
        chunk: `${JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'find src -type f',
            exit_code: 0,
          },
        })}\n`,
      },
      {
        channel: 'stdout',
        chunk: `${JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'npm test',
            exit_code: 1,
          },
        })}\n`,
      },
    ]);

    const events = await collect(provider.parseOutput(output));

    expect(events.filter((event) => event.type === 'output')).toEqual([
      { type: 'output', value: '✓ find src -type f' },
      { type: 'output', value: '✗ npm test' },
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
      '--dangerously-bypass-approvals-and-sandbox',
      '--color',
      'never',
      '-c',
      'analytics.enabled=false',
      'resume',
      '--skip-git-repo-check',
      '--json',
      '--model',
      'modelo',
      'thread-123',
      '-',
    ]);
  });

  test('ativa a busca web ampla do Codex', () => {
    const provider = new CodexProvider({ model: 'modelo' });

    expect(
      provider.applyPermissions(
        {
          default: 'deny',
          allow: { web: [{ operations: ['*'], domains: ['*'] }] },
        },
        undefined,
      ),
    ).toEqual([]);
    const commandArguments = provider.createCommand('pesquise').arguments ?? [];
    expect(commandArguments).toContain('-c');
    expect(commandArguments).toContain('tools.web_search={mode="live"}');
  });

  test('traduz filtros de domínio da busca web', () => {
    const provider = new CodexProvider({ model: 'modelo' });

    provider.applyPermissions(
      {
        default: 'deny',
        allow: {
          web: [
            {
              operations: ['*'],
              domains: ['*'],
              ignores: { domains: ['google.com', '*.google.com'] },
            },
          ],
        },
        deny: { web: [{ operations: ['*'], domains: ['example.com'] }] },
      },
      undefined,
    );

    expect(provider.createCommand('pesquise').arguments).toContain(
      'tools.web_search={mode="live",blocked_domains=["google.com","example.com"]}',
    );
  });

  test('recusa allow de domínio específico, que no Codex abre os subdomínios', () => {
    const provider = new CodexProvider({ model: 'modelo' });

    // A Codex domain also opens its subdomains: looser than the policy.
    expect(() =>
      provider.applyPermissions(
        {
          default: 'deny',
          allow: {
            web: [{ operations: ['*'], domains: ['openai.com'] }],
          },
        },
        undefined,
      ),
    ).toThrow('junto com os subdomínios');
  });

  test('recusa política web que o Codex não representa', () => {
    const provider = new CodexProvider({ model: 'modelo' });

    expect(() =>
      provider.applyPermissions(
        {
          default: 'deny',
          requireApproval: {
            web: [{ operations: ['*'], domains: ['openai.com'] }],
          },
        },
        undefined,
      ),
    ).toThrow('sem requireApproval');
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
