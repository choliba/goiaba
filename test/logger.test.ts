import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, log, openLogger } from '../src/logger/index';
import { adaptLogger } from '../src/logger/adapt';
import { maskRecord, REDACTED } from '../src/logger/mask';
import { toLogRecord, type LogRecord } from '../src/logger/record';
import { readLogRecords } from './support/log-records';

const context = { traceId: 'trace-1', userName: 'dev' };
const ts = '2026-10-26T13:01:39.821Z';

function infoRecord(fields: Record<string, unknown>, message = 'm'): LogRecord {
  return { timestamp: ts, level: 'info', message, fields };
}

describe('toLogRecord', () => {
  test('o consumo vai para gen_ai.usage, com a duração em event', () => {
    const record = toLogRecord(
      {
        ts,
        type: 'usage',
        input_tokens: 5000,
        output_tokens: 300,
        cached_input_tokens: 4000,
        reasoning_tokens: 200,
        duration: 12_000_000_000,
      },
      context,
    );

    expect(record.message).toBe(
      'Consumo do modelo: 5000 tokens de entrada, 300 de saída',
    );
    expect(record.fields).toMatchObject({
      event: { name: 'usage', duration: 12_000_000_000 },
      gen_ai: {
        usage: {
          input_tokens: 5000,
          output_tokens: 300,
          cache_read: { input_tokens: 4000 },
        },
      },
      goiaba: { reasoning_tokens: 200 },
    });
  });

  test('usa os nomes ECS/OTel e põe o resto em goiaba.*', () => {
    const record = toLogRecord(
      {
        ts,
        level: 'debug',
        type: 'command',
        agent: 'assistente',
        run: 'run-1',
        agentProvider: { name: 'ollama', model: 'qwen3.5:4b', cli: 'codex' },
        provider: 'ollama-codex',
        phase: 'spawn',
        executable: 'nsenter',
        arguments: ['--', 'codex'],
        cwd: '/w',
        pid: 42,
        code: 0,
      },
      context,
    );

    expect(record).toEqual({
      timestamp: ts,
      level: 'debug',
      message: 'Comando spawn: nsenter',
      fields: {
        trace: { id: 'trace-1' },
        user: { name: 'dev' },
        transaction: { id: 'run-1' },
        event: { name: 'command' },
        gen_ai: {
          provider: { name: 'ollama' },
          request: { model: 'qwen3.5:4b' },
          agent: { name: 'assistente' },
        },
        process: {
          executable: 'nsenter',
          args: ['--', 'codex'],
          working_directory: '/w',
          pid: 42,
          exit_code: 0,
        },
        goiaba: { cli: 'codex', provider_id: 'ollama-codex', phase: 'spawn' },
      },
    });
  });

  test('ferramentas, sessão, conversa e erros', () => {
    const fields = (activity: Parameters<typeof toLogRecord>[0]) =>
      toLogRecord(activity, context).fields;

    expect(
      fields({
        ts,
        type: 'tool_error',
        level: 'error',
        tool: 'WebFetch',
        call_id: 'c1',
        args: { url: 'https://bun.sh' },
        message: 'negado',
      }),
    ).toMatchObject({
      gen_ai: {
        tool: {
          name: 'WebFetch',
          call: { id: 'c1', arguments: { url: 'https://bun.sh' } },
        },
      },
      error: { message: 'negado' },
    });
    expect(fields({ ts, type: 'session', id: 's1' })).toMatchObject({
      gen_ai: { conversation: { id: 's1' } },
    });
    expect(fields({ ts, type: 'answer', value: 'sim' })).toMatchObject({
      goiaba: { content: 'sim' },
    });
    expect(
      fields({
        ts,
        type: 'command_decision',
        command: 'ls',
        decision: 'allow',
      }),
    ).toMatchObject({
      process: { command_line: 'ls' },
      goiaba: { decision: 'allow' },
    });
    expect(toLogRecord({ ts, type: 'input', value: 'x' }, context).level).toBe(
      'info',
    );
  });
});

describe('maskRecord', () => {
  test('mascara chaves sensíveis, NOME=valor e valores das envs', () => {
    const masked = maskRecord(
      infoRecord(
        {
          goiaba: { headers: { Authorization: 'Bearer abc' }, tokens: 12 },
          process: {
            args: ['CODEX_OSS_BASE_URL=http://x', 'MY_API_KEY=abc123', 'ls'],
          },
          text: 'chave sk-1234567890 aqui',
        },
        'curl -H token sk-1234567890',
      ),
      { CURSOR_API_KEY: 'sk-1234567890', workspace: '/app' },
    );

    expect(masked.fields).toEqual({
      goiaba: { headers: { Authorization: REDACTED }, tokens: 12 },
      process: {
        args: ['CODEX_OSS_BASE_URL=http://x', `MY_API_KEY=${REDACTED}`, 'ls'],
      },
      text: `chave ${REDACTED} aqui`,
    });
    expect(masked.message).toBe(`curl -H token ${REDACTED}`);
  });

  test('não mascara valores curtos de envs', () => {
    expect(
      maskRecord(infoRecord({ text: 'true' }), { SOME_TOKEN: 'true' }).fields,
    ).toEqual({ text: 'true' });
  });
});

describe('adaptLogger', () => {
  const record: LogRecord = {
    timestamp: ts,
    level: 'warn',
    message: 'msg',
    fields: { event: { name: 'x' } },
  };

  test('pino recebe (campos, mensagem) e flush ao fechar', () => {
    const calls: unknown[][] = [];
    const pino = {
      levels: {},
      child() {},
      bindings() {},
      warn(...args: unknown[]) {
        calls.push(['warn', ...args]);
      },
      flush() {
        calls.push(['flush']);
      },
    };

    const sink = adaptLogger(pino);
    sink.write(record);
    sink.close();

    expect(calls).toEqual([
      ['warn', { event: { name: 'x' } }, 'msg'],
      ['flush'],
    ]);
  });

  test('winston recebe um objeto com level e message', () => {
    const calls: unknown[] = [];
    const winston = {
      transports: [],
      log(info: unknown) {
        calls.push(info);
      },
    };

    adaptLogger(winston).write(record);

    expect(calls).toEqual([
      { event: { name: 'x' }, level: 'warn', message: 'msg' },
    ]);
  });

  test('LogTape ou genérico recebem (mensagem, campos)', () => {
    const calls: unknown[][] = [];
    const generic = {
      debug() {},
      info() {},
      warn(...args: unknown[]) {
        calls.push(args);
      },
      error() {},
    };

    adaptLogger(generic).write(record);

    expect(calls).toEqual([['msg', { event: { name: 'x' } }]]);
  });

  test('recusa o que não reconhece', () => {
    expect(() => adaptLogger({ write() {} })).toThrow('não reconhecido');
  });
});

describe('openLogger com o logger da config', () => {
  test('um pino real grava ECS com o nível de cada registro', async () => {
    // Inside the repo, so the config's `import 'pino'` resolves.
    const cwd = mkdtempSync(join(import.meta.dir, 'tmp-logger-'));

    try {
      writeFileSync(
        join(cwd, 'goiaba.config.ts'),
        `import { join } from 'node:path';
import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';
const dest = (file: string) =>
  pino.destination({ dest: file, sync: true, mkdir: true });
export default {
  logger: {
    dir: 'logs',
    use: ({ dir, session }) =>
      pino(
        { ...ecsFormat({ serviceName: 'goiaba' }), level: 'debug' },
        dest(join(dir, session + '.jsonl')),
      ),
  },
};
`,
      );
      await loadConfig({ cwd });

      openLogger();
      log.info({ type: 'input', value: 'olá' });
      log.error({ type: 'error', message: 'falhou' });
      closeLogger();

      const all = readLogRecords(join(cwd, 'logs'));
      expect(all).toEqual([
        expect.objectContaining({
          '@timestamp': expect.any(String),
          'log.level': 'info',
          'ecs.version': expect.any(String),
          'service.name': 'goiaba',
          trace: { id: expect.any(String) },
          event: { name: 'input' },
          message: 'Entrada enviada ao agente',
          goiaba: { content: 'olá' },
        }),
        expect.objectContaining({
          'log.level': 'error',
          message: 'falhou',
          error: { message: 'falhou' },
        }),
      ]);
    } finally {
      closeLogger();
      clearConfigCache();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
