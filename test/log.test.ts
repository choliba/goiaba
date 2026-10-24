import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Agent } from '../src/agent/agent.js';
import { clearConfigCache, loadConfig } from '../src/config/index.js';
import { closeLogger, openLogger } from '../src/log/index.js';
import { DockerSandbox } from '../src/workspace/sandbox/docker.js';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types.js';
import type { Provider, ProviderEvent } from '../src/providers/types.js';
import { Workspace } from '../src/workspace/index.js';

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
    writeFileSync(join(cwd, 'goiaba.config.ts'), `export default { logDir: 'logs' };\n`);
    await loadConfig({ cwd });

    openLogger().log({ type: 'input', value: 'olá' });

    const logDir = join(cwd, 'logs');
    const files = readdirSync(logDir).filter((name) => name.endsWith('.jsonl'));
    expect(files).toHaveLength(1);

    const lines = readFileSync(join(logDir, files[0] ?? ''), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; value?: string });

    expect(lines).toEqual([
      expect.objectContaining({ type: 'input', value: 'olá' }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra o sandbox unrestricted', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logDir: 'logs', debug: true };\n`,
    );
    await loadConfig({ cwd });
    openLogger();

    await new Workspace({ type: 'unrestricted', root: cwd }).prepare({
      executable: 'agent',
      arguments: ['--print'],
      cwd,
    });

    const records = readLogRecords(join(cwd, 'logs'));
    expect(records).toEqual([
      expect.objectContaining({
        level: 'debug',
        type: 'sandbox',
        sandbox: 'unrestricted',
        isolation: false,
        network: { mode: 'host' },
        mounts: [],
        volumes: [],
        command: {
          executable: 'agent',
          arguments: ['--print'],
          cwd,
        },
      }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra montagens e rede do bubblewrap', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logDir: 'logs', debug: true };\n`,
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
    expect(record).toEqual(
      expect.objectContaining({
        level: 'debug',
        type: 'sandbox',
        sandbox: 'bubblewrap',
        network: { unshare: 'all', share: ['net'] },
        workingDir: cwd,
      }),
    );
    expect(record?.mounts).toEqual(
      expect.arrayContaining([
        { type: 'bind', source: '/usr', destination: '/usr', mode: 'ro' },
        { type: 'bind', source: cwd, destination: cwd, mode: 'rw' },
        { type: 'tmpfs', destination: '/tmp' },
      ]),
    );
    expect(record?.mounts).not.toEqual(
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
      `export default { logDir: 'logs', debug: true };\n`,
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
    expect(record).toEqual(
      expect.objectContaining({
        level: 'debug',
        type: 'sandbox',
        sandbox: 'docker',
        image: 'oven/bun:latest',
        network: { mode: 'host' },
        env: ['HOME', 'TOKEN'],
        chroot: '/host',
        chdir: cwd,
      }),
    );
    expect(JSON.stringify(record)).not.toContain('secret');
    expect(record?.volumes).toEqual(
      expect.arrayContaining([`/:/host:ro`, `${cwd}:/host${cwd}:rw`]),
    );
    expect(record?.mounts).toEqual(
      expect.arrayContaining([
        { type: 'bind', source: '/', destination: '/host', mode: 'ro' },
        { type: 'bind', source: cwd, destination: `/host${cwd}`, mode: 'rw' },
        { type: 'tmpfs', destination: '/host/tmp' },
      ]),
    );
    expect(record?.container).toEqual(
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
      `export default { logDir: 'logs', debug: false };\n`,
    );
    await loadConfig({ cwd });

    const logger = openLogger();
    logger.log({ type: 'input', value: 'ok' });
    logger.log({ type: 'command', level: 'debug', executable: 'agent' });

    const logDir = join(cwd, 'logs');
    const files = readdirSync(logDir).filter((name) => name.endsWith('.jsonl'));
    const lines = readFileSync(join(logDir, files[0] ?? ''), 'utf8')
      .trim()
      .split('\n');

    expect(lines).toHaveLength(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('debug registra os comandos executados pelo agente', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logDir: 'logs', debug: true };\n`,
    );
    await loadConfig({ cwd });

    const agent = new Agent({
      prompt: 'mensagem',
      provider: new EchoProvider(),
      workspace: new Workspace({
        type: 'unrestricted',
        root: cwd,
      }),
      interaction: silentInteraction,
    });

    await agent.run();

    const records = readLogRecords(join(cwd, 'logs'));
    const commands = records.filter((record) => record.type === 'command');

    expect(commands).toEqual([
      expect.objectContaining({
        level: 'debug',
        type: 'command',
        phase: 'inner',
        executable: process.execPath,
        arguments: ['-e', 'process.stdin.pipe(process.stdout)'],
        cwd,
      }),
      expect.objectContaining({
        level: 'debug',
        type: 'command',
        phase: 'spawn',
        executable: process.execPath,
        arguments: ['-e', 'process.stdin.pipe(process.stdout)'],
        cwd,
      }),
      expect.objectContaining({
        level: 'debug',
        type: 'command',
        phase: 'exit',
        executable: process.execPath,
        code: 0,
        signal: null,
      }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('Agent.run grava o transcript no logDir', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-log-'));

  try {
    writeFileSync(join(cwd, 'goiaba.config.ts'), `export default { logDir: 'logs' };\n`);
    await loadConfig({ cwd });

    const agent = new Agent({
      prompt: 'mensagem',
      provider: new EchoProvider(),
      workspace: new Workspace({
        type: 'unrestricted',
        root: cwd,
      }),
      interaction: silentInteraction,
    });

    await agent.run();

    const files = readdirSync(join(cwd, 'logs')).filter((name) =>
      name.endsWith('.jsonl'),
    );
    expect(files).toHaveLength(1);

    const records = readFileSync(join(cwd, 'logs', files[0] ?? ''), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; value?: string });

    expect(records).toEqual([
      expect.objectContaining({ type: 'input', value: 'mensagem' }),
      expect.objectContaining({ type: 'output', value: 'mensagem' }),
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function readLogRecords(logDir: string): Array<Record<string, unknown>> {
  const files = readdirSync(logDir).filter((name) => name.endsWith('.jsonl'));
  const file = files[0];

  if (file === undefined) {
    return [];
  }

  const text = readFileSync(join(logDir, file), 'utf8').trim();

  if (text.length === 0) {
    return [];
  }

  return text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

class EchoProvider implements Provider<string, string> {
  public readonly id = 'echo';

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
