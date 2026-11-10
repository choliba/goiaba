import { describe, expect, test } from 'bun:test';

import { UsageError } from '../src/errors';
import {
  cursorCommandPolicy,
  translateCursorPolicy,
} from '../src/providers/cursor/policy';

describe('translateCursorPolicy', () => {
  test('o nativo é --force; o que a CLI não expressa vai a unsupported', () => {
    const { native, unsupported } = translateCursorPolicy({
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
        execution: [{ commands: ['bun *'] }],
      },
      deny: { web: [{ operations: ['search'], domains: ['*'] }] },
    });

    expect(native).toEqual({ force: true });
    expect(unsupported).toEqual([
      {
        category: 'execution',
        source: 'allow',
        rule: { commands: ['bun *'] },
        reason:
          'A CLI do Cursor não decide comandos: --force no --print, a sandbox é o limite.',
        effect: 'looser',
      },
      {
        category: 'web',
        source: 'deny',
        rule: { operations: ['search'], domains: ['*'] },
        reason: 'A CLI do Cursor não tem listas de permissão web.',
        effect: 'looser',
      },
    ]);
  });
});

describe('cursorCommandPolicy', () => {
  test('filesystem sozinho não muda o comando', () => {
    expect(
      cursorCommandPolicy(
        {
          default: 'deny',
          allow: {
            filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
          },
        },
        undefined,
      ),
    ).toBeUndefined();
  });

  test('execution é recusada', () => {
    expect(() =>
      cursorCommandPolicy(
        {
          default: 'deny',
          allow: { execution: [{ commands: ['bun *'] }] },
        },
        {
          hookCommand: ['/bin/bun', '/gate/hook', '/gate/s.sock'],
          root: '/w',
        },
      ),
    ).toThrow(UsageError);
  });
});
