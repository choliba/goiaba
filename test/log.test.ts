import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Agent } from '../src/agent/agent';
import { clearConfigCache, loadConfig } from '../src/config/index';
import { closeLogger, openLogger } from '../src/logger/index';
import { DockerSandbox } from '../src/workspace/sandbox/docker';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types';
import type { Provider, ProviderEvent } from '../src/providers/types';
import { Workspace } from '../src/workspace/index';
import { readLogRecords } from './support/log-records';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  closeLogger();
  clearConfigCache();
});

const silentInteraction = {
  ask: async (): Promise<string> => {
    throw new Error('não deveria perguntar');
  },
  write: (): void => undefined,
};

test('openLogger não cria arquivo sem config carregado', () => {
  const dirs = ['logs', join('.goiaba', 'logs')];
  const snapshots = dirs.map((dir) => {
    const path = join(process.cwd(), dir);
    return {
      path,
      before: existsSync(path) ? readdirSync(path) : undefined,
    };
  });

  openLogger().log({ type: 'input', value: 'x' });

  for (const { path, before } of snapshots) {
    if (before === undefined) {
      expect(existsSync(path)).toBe(false);
    } else {
      expect(readdirSync(path)).toEqual(before);
    }
  }
});

test('openLogger cria o diretório e o jsonl', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' } };\n`,
    );
    await loadConfig({ cwd });

    openLogger().log({ type: 'input', value: 'olá' });

    const logDir = join(cwd, 'logs');
    expect(
      readdirSync(logDir).filter((name) => name.endsWith('.jsonl')),
    ).toHaveLength(1);
    expect(readLogRecords(logDir)).toEqual([
      expect.objectContaining({
        'log.level': 'info',
        'ecs.version': expect.any(String),
        service: { name: 'goiaba', version: expect.any(String) },
        trace: { id: expect.any(String) },
        user: { name: expect.any(String) },
        event: { name: 'input' },
        message: 'Entrada enviada ao agente',
        goiaba: { content: 'olá' },
      }),
    ]);
    const file = readdirSync(logDir).find((name) => name.endsWith('.jsonl'));
    expect(statSync(join(logDir, String(file))).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra montagens e rede do bubblewrap', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' }, debug: true };\n`,
    );
    await loadConfig({ cwd });
    openLogger();

    const workspace = new Workspace({ type: 'bubblewrap', root: cwd });

    try {
      await workspace.prepare({
        executable: 'agent',
        cwd,
      });
    } finally {
      await workspace.close();
    }

    const [record] = readLogRecords(join(cwd, 'logs'));
    const sandbox = goiabaFields(record);
    expect(record).toEqual(
      expect.objectContaining({
        'log.level': 'debug',
        event: { name: 'sandbox' },
      }),
    );
    expect(sandbox).toEqual(
      expect.objectContaining({
        sandbox: 'bubblewrap',
        network: { unshare: 'all', share: ['net'] },
        workingDir: cwd,
      }),
    );
    expect(sandbox['mounts']).toEqual(
      expect.arrayContaining([
        { type: 'bind', source: '/usr', destination: '/usr', mode: 'ro' },
        { type: 'bind', source: cwd, destination: cwd, mode: 'rw' },
        { type: 'tmpfs', destination: '/tmp' },
      ]),
    );
    expect(sandbox['mounts']).not.toEqual(
      expect.arrayContaining([
        { type: 'bind', source: '/', destination: '/', mode: 'ro' },
      ]),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra imagem, volumes e rede do docker', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' }, debug: true };\n`,
    );
    await loadConfig({ cwd });
    openLogger();

    await new DockerSandbox({
      image: 'FROM oven/bun:latest',
      root: cwd,
      env: { HOME: cwd, TOKEN: 'secret' },
    }).prepare({
      executable: 'agent',
      arguments: ['--print'],
      cwd,
    });

    const [record] = readLogRecords(join(cwd, 'logs'));
    const sandbox = goiabaFields(record);
    expect(record).toEqual(
      expect.objectContaining({
        'log.level': 'debug',
        event: { name: 'sandbox' },
      }),
    );
    expect(sandbox).toEqual(
      expect.objectContaining({
        sandbox: 'docker',
        image: 'oven/bun:latest',
        network: { mode: 'host' },
        env: ['HOME', 'TOKEN'],
        chroot: '/host',
        chdir: cwd,
      }),
    );
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(sandbox['volumes']).toEqual(
      expect.arrayContaining([`/:/host:ro`, `${cwd}:/host${cwd}:rw`]),
    );
    expect(sandbox['mounts']).toEqual(
      expect.arrayContaining([
        { type: 'bind', source: '/', destination: '/host', mode: 'ro' },
        { type: 'bind', source: cwd, destination: `/host${cwd}`, mode: 'rw' },
        { type: 'tmpfs', destination: '/host/tmp' },
      ]),
    );
    expect(sandbox['container']).toEqual(
      expect.objectContaining({
        autoRemove: true,
        interactive: true,
        name: expect.stringMatching(/^goiaba-[0-9a-f]{8}$/),
      }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('openLogger omite debug quando debug é false', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' }, debug: false };\n`,
    );
    await loadConfig({ cwd });

    const logger = openLogger();
    logger.log({ type: 'input', value: 'ok' });
    logger.log({ type: 'command', level: 'debug', executable: 'agent' });

    const logDir = join(cwd, 'logs');
    expect(readLogRecords(logDir)).toHaveLength(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra os comandos executados pelo agente', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' }, debug: true };\n`,
    );
    await loadConfig({ cwd });

    const agent = new Agent({
      name: 'teste',
      prompt: 'mensagem',
      provider: new EchoProvider(),
      workspace: new Workspace({
        type: 'bubblewrap',
        root: cwd,
      }),
      interaction: silentInteraction,
    });

    await agent.run();

    const records = readLogRecords(join(cwd, 'logs'));
    const commands = records.filter(
      (record) => eventName(record) === 'command',
    );

    expect(commands.map((record) => record['log.level'])).toEqual([
      'debug',
      'debug',
      'debug',
    ]);
    expect(commands.map((record) => goiabaFields(record)['phase'])).toEqual([
      'inner',
      'spawn',
      'exit',
    ]);
    expect(commands.map((record) => record['process'])).toEqual([
      expect.objectContaining({
        executable: process.execPath,
        args: ['-e', 'process.stdin.pipe(process.stdout)'],
        working_directory: cwd,
      }),
      expect.objectContaining({
        executable: 'nsenter',
        args: expect.arrayContaining([
          process.execPath,
          '-e',
          'process.stdin.pipe(process.stdout)',
        ]),
        working_directory: cwd,
      }),
      expect.objectContaining({
        executable: 'nsenter',
        exit_code: 0,
        pid: expect.any(Number),
        command_line: expect.stringContaining('nsenter --preserve-credentials'),
      }),
    ]);
    // The exit says which command ended and how long it took, and has no
    // `args` of its own (an empty list would read as "no arguments").
    const exit = commands.at(-1);
    expect(exit?.['process']).not.toHaveProperty('args');
    expect(exit?.['event']).toEqual({
      name: 'command',
      duration: expect.any(Number),
    });
    expect(records.map((record) => record['transaction'])).toEqual(
      records.map(() => ({ id: expect.any(String) })),
    );
    // Every record of the agent says which provider, model and CLI.
    for (const record of records) {
      expect(record['gen_ai']).toMatchObject({
        provider: { name: 'echo' },
        request: { model: 'eco-1' },
      });
      expect(goiabaFields(record)['cli']).toBe('node');
    }

    // With debug, the configuration the agent ran with, before its input.
    const [first] = records;
    expect(first).toMatchObject({
      'log.level': 'debug',
      event: { name: 'agent_config' },
      message: 'Configuração do agente',
    });
    expect(goiabaFields(first)['config']).toMatchObject({
      name: 'teste',
      prompt: 'mensagem',
      provider: { name: 'echo', model: 'eco-1', cli: 'node' },
      workspace: { type: 'bubblewrap', root: cwd },
      permissions: null,
      conversation: false,
      goiaba: {
        debug: true,
        logger: { dir: join(cwd, 'logs'), use: false },
      },
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Agent.run grava o transcript no logDir', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { dir: 'logs' } };\n`,
    );
    await loadConfig({ cwd });

    const agent = new Agent({
      name: 'teste',
      prompt: 'mensagem',
      provider: new EchoProvider(),
      workspace: new Workspace({
        type: 'bubblewrap',
        root: cwd,
      }),
      interaction: silentInteraction,
    });

    await agent.run();

    expect(
      readdirSync(join(cwd, 'logs')).filter((name) => name.endsWith('.jsonl')),
    ).toHaveLength(1);
    expect(readLogRecords(join(cwd, 'logs'))).toEqual([
      expect.objectContaining({
        event: { name: 'input' },
        goiaba: { cli: 'node', content: 'mensagem' },
      }),
      expect.objectContaining({
        event: { name: 'output' },
        goiaba: { cli: 'node', content: 'mensagem' },
      }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

class EchoProvider implements Provider<string, string> {
  public readonly id = 'echo';

  public describe() {
    return { name: 'echo', model: 'eco-1', cli: 'node' };
  }

  public createCommand(input: string): ProgramCommand {
    return {
      executable: process.execPath,
      arguments: ['-e', 'process.stdin.pipe(process.stdout)'],
      input,
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') {
        yield { type: 'output', value: chunk };
      }
    }
  }
}

function eventName(record: Record<string, unknown> | undefined): unknown {
  const event = record?.['event'];
  return typeof event === 'object' && event !== null && 'name' in event
    ? event.name
    : undefined;
}

/** Goiaba's own fields of a record (`goiaba.*`). */
function goiabaFields(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const fields = record?.['goiaba'];
  return typeof fields === 'object' && fields !== null
    ? Object.fromEntries(Object.entries(fields))
    : {};
}
