import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
  clearConfigCache,
  defineConfig,
  loadConfig,
} from '../src/config/index.js';
import { UsageError } from '../src/usage.js';

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
    logDir: 'logs',
    debug: true,
  });

  expect(config).toEqual({
    logDir: 'logs',
    debug: true,
  });
});

test('loadConfig usa defaults quando não há arquivo', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'goiaba-config-'));

  try {
    const config = await loadConfig({ cwd });

    expect(config).toEqual({
      logDir: resolve(cwd, '.goiaba/logs'),
      debug: false,
      configPath: undefined,
      env: undefined,
      envs: [],
    });
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
  logDir: 'out/logs',
  debug: true,
});
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logDir).toBe(resolve(cwd, 'out/logs'));
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
      `export default async () => ({ debug: true, logDir: 'async-logs' });
`,
    );

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logDir).toBe(resolve(cwd, 'async-logs'));
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
      `export default { debug: true, logDir: 'root-logs' };
`,
    );

    const config = await loadConfig({ cwd: nested });

    expect(config.debug).toBe(true);
    expect(config.logDir).toBe(resolve(cwd, 'root-logs'));
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
      `export default { debug: false, logDir: 'file-logs' };
`,
    );
    process.env['GOIABA_DEBUG'] = 'true';
    process.env['GOIABA_LOG_DIR'] = '/tmp/goiaba-env-logs';

    const config = await loadConfig({ cwd });

    expect(config.debug).toBe(true);
    expect(config.logDir).toBe('/tmp/goiaba-env-logs');
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
