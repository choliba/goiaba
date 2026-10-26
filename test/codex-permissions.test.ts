import { describe, expect, test } from 'bun:test';

import { buildCodexPermissions } from '../src/providers/codex/permissions';

describe('buildCodexPermissions', () => {
  test('comandos viram prefix_rule; só o * no fim é exato para liberar', () => {
    const { native, unsupported } = buildCodexPermissions({
      default: 'deny',
      allow: {
        execution: [
          {
            commands: ['npm *', 'git status'],
            ignores: { commands: ['npm publish *'] },
          },
        ],
      },
      requireApproval: { execution: [{ commands: ['git push *'] }] },
      deny: {
        execution: [{ commands: ['sudo *', 'npm publish *', 'curl * | sh'] }],
      },
    });

    expect(native.rules.split('\n')).toEqual([
      'prefix_rule(pattern=["npm"], decision="allow")',
      'prefix_rule(pattern=["npm","publish"], decision="forbidden")',
      'prefix_rule(pattern=["git","push"], decision="prompt")',
      'prefix_rule(pattern=["sudo"], decision="forbidden")',
    ]);
    expect(unsupported.map((rule) => rule.reason)).toEqual([
      'O Codex compara pelo começo: liberar "git status" liberaria também "git status …".',
      'O Codex só aceita comandos com * no fim: curl * | sh',
    ]);
  });

  test('filesystem: escrita no projeto vira workspace-write; leitura não se limita', () => {
    const { native, unsupported } = buildCodexPermissions({
      default: 'deny',
      allow: {
        filesystem: [
          { operations: ['*'], paths: ['/workspace/**'] },
          { operations: ['write'], paths: ['/tmp/build/**'] },
        ],
      },
    });

    expect(native.config).toMatchObject({
      sandbox_mode: '"workspace-write"',
      'sandbox_workspace_write.writable_roots': '["/tmp/build"]',
    });
    expect(unsupported.map((rule) => rule.reason)).toEqual([
      'O Codex lê qualquer caminho do disco: só a escrita fica limitada.',
    ]);
  });

  test('web, rede, MCP e variáveis de ambiente nas configurações do Codex', () => {
    const { native } = buildCodexPermissions({
      default: 'deny',
      allow: {
        web: [
          {
            operations: ['search', 'read_text'],
            domains: ['*'],
            ignores: { domains: ['google.com'] },
          },
        ],
        network: [{ operations: ['connect'], hosts: ['*'] }],
        tools: [
          {
            operations: ['call'],
            tools: ['github/*', 'docs/search'],
            ignores: { tools: ['github/delete_repository'] },
          },
        ],
        secrets: [
          { operations: ['read'], secrets: ['NODE_ENV', 'DATABASE_*'] },
        ],
      },
      deny: {
        tools: [{ operations: ['*'], tools: ['slack'] }],
        secrets: [{ operations: ['*'], secrets: ['*_TOKEN'] }],
      },
    });

    expect(native.config).toEqual({
      sandbox_mode: '"read-only"',
      'tools.web_search': '{mode="live",blocked_domains=["google.com"]}',
      'sandbox_workspace_write.network_access': 'true',
      'mcp_servers.docs.enabled_tools': '["search"]',
      'mcp_servers.github.disabled_tools': '["delete_repository"]',
      'mcp_servers.slack.enabled': 'false',
      'shell_environment_policy.include_only': '["NODE_ENV","DATABASE_*"]',
      'shell_environment_policy.exclude': '["*_TOKEN"]',
    });
    expect(native.rules).toBe('');
  });

  test('sem web liberada, a busca fica desligada', () => {
    expect(
      buildCodexPermissions({ default: 'deny' }).native.config[
        'tools.web_search'
      ],
    ).toBe('{mode="disabled"}');
  });

  test('o que o Codex não expressa vai para unsupported, sem sumir', () => {
    const { unsupported } = buildCodexPermissions({
      default: 'deny',
      allow: {
        agents: [{ operations: ['spawn'], agents: ['revisor'] }],
        communication: [{ operations: ['send_logs'], channels: ['*'] }],
        network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
      },
      requireApproval: {
        web: [{ operations: ['login'], domains: ['*'] }],
      },
    });

    expect(
      unsupported.map((rule) => `${rule.source}.${rule.category}`),
    ).toEqual([
      'requireApproval.web',
      'allow.network',
      'allow.agents',
      'allow.communication',
    ]);
  });
});
