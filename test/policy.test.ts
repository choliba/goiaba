import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { UsageError } from '../src/errors';
import {
  compileFilesystemAccess,
  delegatedCategories,
  PolicyEngine,
  suggestPattern,
  wildmatch,
} from '../src/policy/index';
import type { AgentPolicy } from '../src/policy/index';

describe('Git wildmatch', () => {
  test('distingue estrela simples de globstar', () => {
    expect(wildmatch('/workspace/src/index.ts', '/workspace/*')).toBe(false);
    expect(wildmatch('/workspace/src/index.ts', '/workspace/**')).toBe(true);
    expect(wildmatch('/workspace/index.ts', '/workspace/**/index.ts')).toBe(
      true,
    );
  });

  test('suporta ?, classes, escape e case-sensitive', () => {
    expect(wildmatch('file-1.ts', 'file-[0-9].t?')).toBe(true);
    expect(wildmatch('file-*.ts', String.raw`file-\*.ts`)).toBe(true);
    expect(wildmatch('README.md', 'readme.md')).toBe(false);
  });

  test('rejeita padrões inválidos', () => {
    expect(() => wildmatch('x', '[abc')).toThrow(UsageError);
    expect(() => wildmatch('x', 'abc\\')).toThrow(UsageError);
  });
});

describe('suggestPattern', () => {
  test('sugere padrão só para comando simples', () => {
    expect(suggestPattern('mkdir -p src/pages')).toBe('mkdir *');
    expect(suggestPattern('cd a && rm b')).toBe('cd a && rm b');
    expect(suggestPattern('cat > a')).toBe('cat > a');
    expect(suggestPattern('pwd')).toBe('pwd');
  });
});

describe('PolicyEngine', () => {
  test('aplica deny sobre approval e allow', () => {
    const engine = new PolicyEngine({
      default: 'deny',
      allow: { filesystem: [rule('/workspace/**')] },
      requireApproval: { filesystem: [rule('/workspace/private/**')] },
      deny: { filesystem: [rule('/workspace/private/secret/**')] },
    });

    expect(checkPath(engine, '/workspace/src/index.ts')).toBe('allow');
    expect(checkPath(engine, '/workspace/private/readme.md')).toBe(
      'require_approval',
    );
    expect(checkPath(engine, '/workspace/private/secret/key')).toBe('deny');
    expect(checkPath(engine, '/outside')).toBe('deny');
  });

  test('ignores remove somente a regra correspondente', () => {
    const engine = new PolicyEngine({
      default: 'deny',
      allow: {
        filesystem: [
          {
            ...rule('/workspace/**'),
            ignores: { paths: ['/workspace/node_modules/**'] },
          },
        ],
      },
    });

    expect(checkPath(engine, '/workspace/source.ts')).toBe('allow');
    expect(checkPath(engine, '/workspace/node_modules/pkg/index.js')).toBe(
      'deny',
    );
  });

  test('avalia seletores das demais categorias', () => {
    const engine = new PolicyEngine({
      default: 'deny',
      allow: {
        web: [{ operations: ['search'], domains: ['*.github.com'] }],
        execution: [
          { commands: ['bun *'], ignores: { commands: ['bun publish*'] } },
        ],
        communication: [
          { operations: ['send_logs'], channels: ['internal_*'] },
        ],
      },
    });

    expect(
      engine.check({
        category: 'web',
        operation: 'search',
        domain: 'api.github.com',
      }).policy,
    ).toBe('allow');
    expect(
      engine.check({ category: 'execution', command: 'bun test' }).policy,
    ).toBe('allow');
    expect(
      engine.check({ category: 'execution', command: 'bun publish' }).policy,
    ).toBe('deny');
    expect(
      engine.check({ category: 'execution', command: 'npm test' }).policy,
    ).toBe('deny');
    expect(
      engine.check({
        category: 'communication',
        operation: 'send_logs',
        channel: 'internal_dev',
      }).policy,
    ).toBe('allow');
  });

  test('solicita aprovação uma vez para a ação atual', async () => {
    const engine = new PolicyEngine({
      default: 'require_approval',
    });
    let approvals = 0;

    const authorized = await engine.authorize(
      { category: 'filesystem', operation: 'read', path: '/workspace/file' },
      async ({ decision }) => {
        approvals += 1;
        expect(decision.policy).toBe('require_approval');
        return true;
      },
    );

    expect(authorized).toBe(true);
    expect(approvals).toBe(1);
  });
});

describe('filesystem enforcement compiler', () => {
  test('compila escrita global com subárvore escondida', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const modules = join(root, 'node_modules');
    mkdirSync(modules);

    try {
      const access = compileFilesystemAccess(
        {
          default: 'deny',
          allow: {
            filesystem: [
              {
                operations: ['read', 'write'],
                paths: ['/workspace/**'],
                ignores: { paths: ['/workspace/node_modules/**'] },
              },
            ],
          },
        },
        root,
      );

      expect(access).toEqual({
        workspaceAccess: 'readwrite',
        writable: [],
        masks: [{ path: modules, access: 'hidden' }],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('aceita o caminho real do root como alias de /workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const git = join(root, '.git');
    mkdirSync(git);

    try {
      const access = compileFilesystemAccess(
        {
          default: 'deny',
          allow: {
            filesystem: [
              {
                operations: ['read', 'write'],
                paths: [`${root}/**`],
                ignores: { paths: [`${root}/.git/**`] },
              },
            ],
          },
        },
        root,
      );

      expect(access).toEqual({
        workspaceAccess: 'readwrite',
        writable: [],
        masks: [{ path: git, access: 'hidden' }],
      });
      expect(() =>
        compileFilesystemAccess(
          {
            default: 'deny',
            allow: { filesystem: [rule(`${root}-outro/**`)] },
          },
          root,
        ),
      ).toThrow('não pode ser compilado');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('compila leitura do workspace inteiro e escrita só numa pasta', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const guides = join(root, 'guides');
    mkdirSync(guides);

    try {
      const access = compileFilesystemAccess(
        {
          default: 'deny',
          allow: {
            filesystem: [
              { operations: ['read'], paths: ['/workspace/**'] },
              { operations: ['write'], paths: ['/workspace/guides/**'] },
            ],
          },
        },
        root,
      );

      expect(access).toEqual({
        workspaceAccess: 'readonly',
        writable: [guides],
        masks: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('recusa pasta gravável que não existe, com padrão ou com leitura', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    mkdirSync(join(root, 'guides'));
    const compile = (operations: ('read' | 'write')[], path: string) =>
      compileFilesystemAccess(
        {
          default: 'deny',
          allow: {
            filesystem: [
              { operations: ['read'], paths: ['/workspace/**'] },
              { operations, paths: [path] },
            ],
          },
        },
        root,
      );

    try {
      expect(() => compile(['write'], '/workspace/docs/**')).toThrow(
        'precisa existir',
      );
      expect(() => compile(['write'], '/workspace/gui*/**')).toThrow(
        'não pode ser compilado',
      );
      expect(() => compile(['read', 'write'], '/workspace/guides/**')).toThrow(
        'não pode ser compilado',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('delega ao provider as categorias que a sandbox não aplica', () => {
    expect(
      delegatedCategories({
        default: 'deny',
        allow: {
          filesystem: [rule('/workspace/**')],
          web: [{ operations: ['search'], domains: ['*'] }],
        },
        deny: { execution: [{ commands: ['sudo *'] }] },
      }),
    ).toEqual(['web', 'execution']);
  });

  test('rejeita aprovação e padrão sem enforcement', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const base: AgentPolicy = {
      default: 'deny',
      allow: { filesystem: [rule('/workspace/**')] },
    };

    try {
      expect(() =>
        compileFilesystemAccess(
          {
            ...base,
            requireApproval: { filesystem: [rule('/workspace/**')] },
          },
          root,
        ),
      ).toThrow('Aprovação');
      expect(() =>
        compileFilesystemAccess(
          {
            ...base,
            deny: { filesystem: [rule('/workspace/**/secret')] },
          },
          root,
        ),
      ).toThrow('só aceita ** no fim do caminho');
      expect(() =>
        compileFilesystemAccess(
          {
            ...base,
            default: 'require_approval',
          },
          root,
        ),
      ).toThrow('default deny');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('expande padrões para os arquivos que existem ao iniciar', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    for (const file of [
      '.env',
      '.env.local',
      '.env.example',
      'bun.lock',
      'a.ts',
    ]) {
      writeFileSync(join(root, file), '');
    }
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'db.json'), '');

    try {
      const access = compileFilesystemAccess(
        {
          default: 'deny',
          allow: {
            filesystem: [
              { operations: ['read'], paths: ['/workspace/**'] },
              {
                operations: ['write'],
                paths: ['/workspace/**'],
                ignores: { paths: ['/workspace/*.lock'] },
              },
            ],
          },
          deny: {
            filesystem: [
              {
                operations: ['*'],
                paths: [
                  '/workspace/.env',
                  '/workspace/.env.*',
                  '/workspace/config/*.json',
                ],
                ignores: { paths: ['/workspace/.env.example'] },
              },
            ],
          },
        },
        root,
      );

      expect(access.masks).toEqual([
        { path: join(root, 'bun.lock'), access: 'readonly' },
        { path: join(root, '.env'), access: 'hidden' },
        { path: join(root, '.env.local'), access: 'hidden' },
        { path: join(root, 'config', 'db.json'), access: 'hidden' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('não deixa visível um caminho dentro de uma pasta escondida', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    mkdirSync(join(root, 'secrets'));
    writeFileSync(join(root, 'secrets', 'public.txt'), '');

    try {
      expect(() =>
        compileFilesystemAccess(
          {
            default: 'deny',
            allow: { filesystem: [rule('/workspace/**')] },
            deny: {
              filesystem: [
                {
                  operations: ['*'],
                  paths: ['/workspace/secrets/**'],
                  ignores: { paths: ['/workspace/secrets/public.txt'] },
                },
              ],
            },
          },
          root,
        ),
      ).toThrow('a sandbox esconde a pasta inteira');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejeita symlink que escapa do workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const outside = mkdtempSync(join(tmpdir(), 'goiaba-outside-'));
    symlinkSync(outside, join(root, 'escape'));

    try {
      expect(() =>
        compileFilesystemAccess(
          {
            default: 'deny',
            allow: { filesystem: [rule('/workspace/**')] },
            deny: { filesystem: [rule('/workspace/escape/**')] },
          },
          root,
        ),
      ).toThrow('symlink externo');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

function rule(path: string) {
  return { operations: ['read'] as const, paths: [path] };
}

function checkPath(engine: PolicyEngine, path: string) {
  return engine.check({ category: 'filesystem', operation: 'read', path })
    .policy;
}

describe('PolicyEngine: categorias novas', () => {
  const engine = new PolicyEngine({
    default: 'deny',
    allow: {
      network: [{ operations: ['connect'], hosts: ['*.github.com'] }],
      tools: [
        {
          operations: ['call'],
          tools: ['github/*'],
          ignores: { tools: ['github/delete_repository'] },
        },
      ],
      agents: [{ operations: ['spawn'], agents: ['revisor'] }],
      secrets: [{ operations: ['read'], secrets: ['DATABASE_*'] }],
    },
    requireApproval: {
      secrets: [{ operations: ['read'], secrets: ['DATABASE_PASSWORD'] }],
    },
  });

  const policy = (action: Parameters<PolicyEngine['check']>[0]) =>
    engine.check(action).policy;

  test('decide network, tools, agents e secrets pelos alvos de cada uma', () => {
    expect(
      policy({
        category: 'network',
        operation: 'connect',
        host: 'api.github.com',
      }),
    ).toBe('allow');
    expect(
      policy({
        category: 'network',
        operation: 'connect',
        host: 'example.com',
      }),
    ).toBe('deny');
    expect(
      policy({
        category: 'tools',
        operation: 'call',
        tool: 'github/create_issue',
      }),
    ).toBe('allow');
    expect(
      policy({
        category: 'tools',
        operation: 'call',
        tool: 'github/delete_repository',
      }),
    ).toBe('deny');
    expect(
      policy({ category: 'agents', operation: 'spawn', agent: 'revisor' }),
    ).toBe('allow');
    expect(
      policy({
        category: 'secrets',
        operation: 'read',
        secret: 'DATABASE_URL',
      }),
    ).toBe('allow');
    expect(
      policy({
        category: 'secrets',
        operation: 'read',
        secret: 'DATABASE_PASSWORD',
      }),
    ).toBe('require_approval');
  });

  test('regra sem alvos é recusada', () => {
    expect(
      () =>
        new PolicyEngine({
          default: 'deny',
          allow: { network: [{ operations: ['connect'], hosts: [] }] },
        }),
    ).toThrow('Uma regra network precisa ter alvos.');
  });
});
