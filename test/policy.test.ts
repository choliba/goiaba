import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { UsageError } from '../src/errors.js';
import {
  compileFilesystemAccess,
  PolicyEngine,
  wildmatch,
} from '../src/policy/index.js';
import type { AgentPermissions } from '../src/policy/types.js';

describe('Git wildmatch', () => {
  test('distingue estrela simples de globstar', () => {
    expect(wildmatch('/workspace/src/index.ts', '/workspace/*')).toBe(false);
    expect(wildmatch('/workspace/src/index.ts', '/workspace/**')).toBe(true);
    expect(wildmatch('/workspace/index.ts', '/workspace/**/index.ts')).toBe(true);
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
        execution: [{ operations: ['lint'], environments: ['sandbox_*'] }],
        communication: [{ operations: ['send_logs'], channels: ['internal_*'] }],
      },
    });

    expect(engine.check({ category: 'web', operation: 'search', domain: 'api.github.com' }).policy).toBe('allow');
    expect(engine.check({ category: 'execution', operation: 'lint', environment: 'sandbox_docker' }).policy).toBe('allow');
    expect(engine.check({ category: 'communication', operation: 'send_logs', channel: 'internal_dev' }).policy).toBe('allow');
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
      const access = compileFilesystemAccess({
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
      }, root);

      expect(access).toEqual({
        workspaceAccess: 'readwrite',
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
      const access = compileFilesystemAccess({
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
      }, root);

      expect(access).toEqual({
        workspaceAccess: 'readwrite',
        masks: [{ path: git, access: 'hidden' }],
      });
      expect(() => compileFilesystemAccess({
        default: 'deny',
        allow: { filesystem: [rule(`${root}-outro/**`)] },
      }, root)).toThrow('não pode ser compilado');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejeita categoria, aprovação e padrão sem enforcement', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const base: AgentPermissions = {
      default: 'deny',
      allow: { filesystem: [rule('/workspace/**')] },
    };

    try {
      expect(() => compileFilesystemAccess({
        ...base,
        allow: { ...base.allow, web: [{ operations: ['search'], domains: ['*'] }] },
      }, root)).toThrow('web');
      expect(() => compileFilesystemAccess({
        ...base,
        requireApproval: { filesystem: [rule('/workspace/**')] },
      }, root)).toThrow('Aprovação');
      expect(() => compileFilesystemAccess({
        ...base,
        deny: { filesystem: [rule('/workspace/*/secret')] },
      }, root)).toThrow('não pode ser compilado');
      expect(() => compileFilesystemAccess({
        ...base,
        default: 'require_approval',
      }, root)).toThrow('default deny');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejeita symlink que escapa do workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const outside = mkdtempSync(join(tmpdir(), 'goiaba-outside-'));
    symlinkSync(outside, join(root, 'escape'));

    try {
      expect(() => compileFilesystemAccess({
        default: 'deny',
        allow: { filesystem: [rule('/workspace/**')] },
        deny: { filesystem: [rule('/workspace/escape/**')] },
      }, root)).toThrow('symlink externo');
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
  return engine.check({ category: 'filesystem', operation: 'read', path }).policy;
}
