import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
  clearConfigCache,
  defineConfig,
  loadConfig,
} from '../src/config/index';
import { UsageError } from '../src/usage';

const defineConfigHref = pathToFileURL(
  resolve(import.meta.dir, '../src/config/index.ts'),
).href;

const originalDebug = process.env['GOIABA_DEBUG'];
const originalLogDir = process.env['GOIABA_LOG_DIR'];
const originalEnv = process.env['GOIABA_ENV'];

function readEnv(name: string): string | undefined {
  return process.env[name];
}

beforeEach(() => {
  clearConfigCache();
  delete process.env['GOIABA_DEBUG'];
  delete process.env['GOIABA_LOG_DIR'];
  delete process.env['GOIABA_ENV'];
});

afterEach(() => {
  clearConfigCache();

  if (originalDebug === undefined) {
    delete process.env['GOIABA_DEBUG'];
  } else {
    process.env['GOIABA_DEBUG'] = originalDebug;
  }

  if (originalLogDir === undefined) {
    delete process.env['GOIABA_LOG_DIR'];
  } else {
    process.env['GOIABA_LOG_DIR'] = originalLogDir;
  }

  if (originalEnv === undefined) {
    delete process.env['GOIABA_ENV'];
  } else {
    process.env['GOIABA_ENV'] = originalEnv;
  }
});

test('defineConfig devolve a configuração', () => {
  const config = defineConfig({
    logger: { dir: 'logs' },
    debug: true,
  });

  expect(config).toEqual({
    logger: { dir: 'logs' },
    debug: true,
  });
});

test('database: diretório e nome configuráveis, padrão próprio em .goiaba', async () => {
  const cwds: string[] = [];
  // One directory per config: imports are cached by file and mtime.
  const load = async (config: string) => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));
    cwds.push(cwd);
    writeFileSync(join(cwd, 'goiaba.config.ts'), `export default ${config};\n`);
    clearConfigCache();
    return { cwd, config: loadConfig({ cwd }) };
  };

  try {
    const custom = await load(
      "{ logger: { dir: 'logs' }, database: { dir: 'dados', name: 'agentes.db' } }",
    );
    expect((await custom.config).databasePath).toBe(
      resolve(custom.cwd, 'dados/agentes.db'),
    );

    const nameOnly = await load(
      "{ logger: { dir: 'logs' }, database: { name: 'x.db' } }",
    );
    expect((await nameOnly.config).databasePath).toBe(
      resolve(nameOnly.cwd, '.goiaba/x.db'),
    );

    const outside = await load("{ database: { name: '../fora.db' } }");
    await expect(outside.config).rejects.toThrow('database.name');
  } finally {
    for (const cwd of cwds) rmSync(cwd, { recursive: true, force: true });
  }
});

test('opção desconhecida para o carregamento e aponta a certa', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { databasePath: '/x/db' };\n`,
    );
    await expect(loadConfig({ cwd })).rejects.toThrow(
      'Opção desconhecida "databasePath"',
    );
    await expect(loadConfig({ cwd })).rejects.toThrow(
      'database: { dir, name }',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('logDir antigo aponta para logger.dir', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logDir: 'logs' };\n`,
    );
    await expect(loadConfig({ cwd })).rejects.toThrow('logger: { dir }');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('logger.use precisa ser uma função', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { logger: { use: {} } };\n`,
    );
    await expect(loadConfig({ cwd })).rejects.toThrow('logger.use');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig usa defaults quando não há arquivo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    const config = await loadConfig({ cwd });

    expect(config).toEqual({
      logger: { dir: resolve(cwd, '.goiaba/logs'), use: undefined },
      databasePath: resolve(cwd, '.goiaba/goiaba.db'),
      workspaces: {
        dir: resolve(cwd, '.goiaba/workspaces'),
        homes: resolve(cwd, '.goiaba/homes'),
      },
      debug: false,
      configPath: undefined,
      env: undefined,
      envs: [],
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig resolve workspaces.dir a partir do arquivo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { workspaces: { dir: 'storage/workspaces' } };\n`,
    );
    const config = await loadConfig({ cwd });
    expect(config.workspaces.dir).toBe(resolve(cwd, 'storage/workspaces'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig resolve workspaces.homes e recusa o homes antigo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { workspaces: { homes: 'storage/homes' } };\n`,
    );
    const config = await loadConfig({ cwd });
    expect(config.workspaces.homes).toBe(resolve(cwd, 'storage/homes'));

    const old = join(cwd, 'antigo');
    mkdirSync(old);
    writeFileSync(
      join(old, 'goiaba.config.ts'),
      `export default { homes: { dir: 'storage/homes' } };\n`,
    );
    await expect(loadConfig({ cwd: old })).rejects.toThrow(
      'workspaces: { homes }',
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig recusa uma opção desconhecida em workspaces', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { workspaces: { home: 'storage/homes' } };\n`,
    );
    await expect(loadConfig({ cwd })).rejects.toThrow('workspaces.home');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig recusa workspaces.dir vazio', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { workspaces: { dir: ' ' } };\n`,
    );
    await expect(loadConfig({ cwd })).rejects.toThrow('workspaces.dir');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig lê goiaba.config.ts', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `import { defineConfig } from ${JSON.stringify(defineConfigHref)};

export default defineConfig({
  logger: { dir: 'out/logs' },
  debug: true,
});
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logger.dir).toBe(resolve(cwd, 'out/logs'));
    expect(config.configPath).toBe(join(cwd, 'goiaba.config.ts'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig aceita factory assíncrona', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default async () => ({ debug: true, logger: { dir: 'async-logs' } });
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logger.dir).toBe(resolve(cwd, 'async-logs'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig sobe diretórios até achar o arquivo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));
  const nested = join(cwd, 'agents', 'nested');
  mkdirSync(nested, { recursive: true });

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { debug: true, logger: { dir: 'root-logs' } };
`,
    );

    const config = await loadConfig({ cwd: nested });

    expect(config.debug).toBe(true);
    expect(config.logger.dir).toBe(resolve(cwd, 'root-logs'));
    expect(config.configPath).toBe(join(cwd, 'goiaba.config.ts'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('variáveis GOIABA_* têm prioridade sobre o arquivo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default { debug: false, logger: { dir: 'file-logs' } };
`,
    );
    process.env['GOIABA_DEBUG'] = 'true';
    process.env['GOIABA_LOG_DIR'] = '/tmp/goiaba-env-logs';

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logger.dir).toBe('/tmp/goiaba-env-logs');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig usa o primeiro env', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default {
  envs: [
    { TOKEN: 'one' },
    { TOKEN: 'two' },
  ],
};
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.env).toEqual({ vars: { TOKEN: 'one' } });
    expect(config.envs).toHaveLength(2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('loadConfig guarda variáveis livres no env', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));
  const originalKey = process.env['GOIABA_TEST_FREE_VAR'];

  try {
    delete process.env['GOIABA_TEST_FREE_VAR'];
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default {
  envs: [
    {
      CURSOR_API_KEY: 'crsr_test',
      GOIABA_TEST_FREE_VAR: 'ok',
      OUTRA: undefined,
    },
  ],
};
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.env).toEqual({
      vars: {
        CURSOR_API_KEY: 'crsr_test',
        GOIABA_TEST_FREE_VAR: 'ok',
      },
    });
    expect(readEnv('GOIABA_TEST_FREE_VAR')).toBe('ok');
  } finally {
    rmSync(cwd, { recursive: true, force: true });

    if (originalKey === undefined) {
      delete process.env['GOIABA_TEST_FREE_VAR'];
    } else {
      process.env['GOIABA_TEST_FREE_VAR'] = originalKey;
    }
  }
});

test('loadConfig não sobrescreve process.env já definido', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));
  const originalKey = process.env['GOIABA_TEST_FREE_VAR'];

  try {
    process.env['GOIABA_TEST_FREE_VAR'] = 'host';
    writeFileSync(
      join(cwd, 'goiaba.config.ts'),
      `export default {
  envs: [{ GOIABA_TEST_FREE_VAR: 'config' }],
};
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.env?.vars).toEqual({ GOIABA_TEST_FREE_VAR: 'config' });
    expect(readEnv('GOIABA_TEST_FREE_VAR')).toBe('host');
  } finally {
    rmSync(cwd, { recursive: true, force: true });

    if (originalKey === undefined) {
      delete process.env['GOIABA_TEST_FREE_VAR'];
    } else {
      process.env['GOIABA_TEST_FREE_VAR'] = originalKey;
    }
  }
});

test('loadConfig rejeita default inválido', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    writeFileSync(join(cwd, 'goiaba.config.ts'), `export default 'nope';\n`);

    await expect(loadConfig({ cwd })).rejects.toBeInstanceOf(UsageError);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
