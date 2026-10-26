import { describe, expect, test } from 'bun:test';

import { buildClaudePermissions } from '../src/providers/claude/permissions';

describe('buildClaudePermissions', () => {
  test('allow, requireApproval e deny viram allow, ask e deny', () => {
    const { native } = buildClaudePermissions({
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['*'], paths: ['/workspace/src/**'] }],
        execution: [{ commands: ['bun *'] }],
      },
      requireApproval: { execution: [{ commands: ['git push *'] }] },
      deny: { filesystem: [{ operations: ['read'], paths: ['/etc/passwd'] }] },
    });

    expect(native).toEqual({
      allow: ['Read(./src/**)', 'Edit(./src/**)', 'Bash(bun *)'],
      ask: ['Bash(git push *)'],
      deny: ['Read(//etc/passwd)'],
    });
  });

  test('ignores de allow negam só as operações que nenhuma outra regra alcança', () => {
    const { native, unsupported } = buildClaudePermissions({
      default: 'deny',
      allow: {
        filesystem: [
          {
            operations: ['read', 'write'],
            paths: ['/workspace/**'],
            ignores: { paths: ['/workspace/.git/**'] },
          },
          { operations: ['read'], paths: ['/workspace/.git/**'] },
        ],
      },
    });

    // .git stays readable (the second rule) and is not editable.
    expect(native.deny).toEqual(['Edit(./.git/**)']);
    expect(native.allow).toContain('Read(./.git/**)');
    expect(unsupported).toEqual([]);
  });

  test('web: busca só para todos os domínios; ferramentas de navegador não existem', () => {
    const { native, unsupported } = buildClaudePermissions({
      default: 'deny',
      allow: {
        web: [
          { operations: ['read_text'], domains: ['bun.sh', '*.github.com'] },
          { operations: ['search'], domains: ['bun.sh'] },
          { operations: ['login'], domains: ['*'] },
        ],
      },
    });

    expect(native.allow).toEqual([
      'WebFetch(domain:bun.sh)',
      'WebFetch(domain:*.github.com)',
    ]);
    expect(unsupported.map((rule) => rule.reason)).toEqual([
      'A busca do Claude não se limita a domínios.',
      'O Claude não tem ferramenta para login.',
    ]);
  });

  test('MCP e subagentes na sintaxe do Claude', () => {
    const { native, unsupported } = buildClaudePermissions({
      default: 'deny',
      allow: {
        tools: [
          { operations: ['call'], tools: ['github/*', 'docs/search', 'slack'] },
        ],
        agents: [{ operations: ['spawn'], agents: ['revisor'] }],
      },
      deny: {
        tools: [{ operations: ['*'], tools: ['*/delete_*'] }],
        agents: [{ operations: ['*'], agents: ['claude-haiku-*'] }],
      },
    });

    expect(native.allow).toEqual([
      'mcp__github__*',
      'mcp__docs__search',
      'mcp__slack',
      'Agent(revisor)',
    ]);
    expect(native.deny).toEqual([]);
    expect(unsupported.map((rule) => rule.category)).toEqual([
      'tools',
      'agents',
    ]);
  });

  test('o que o Claude não controla vai para unsupported, sem sumir', () => {
    const { native, unsupported } = buildClaudePermissions({
      default: 'deny',
      allow: {
        network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
        communication: [{ operations: ['send_logs'], channels: ['*'] }],
        secrets: [{ operations: ['read'], secrets: ['NODE_ENV'] }],
      },
      deny: {
        execution: [
          { commands: ['rm -rf *'], ignores: { commands: ['rm -rf dist'] } },
        ],
      },
    });

    expect(native).toEqual({ allow: [], ask: [], deny: ['Bash(rm -rf *)'] });
    expect(
      unsupported.map((rule) => `${rule.source}.${rule.category}`),
    ).toEqual([
      'allow.network',
      'allow.communication',
      'allow.secrets',
      'deny.execution',
    ]);
  });
});
