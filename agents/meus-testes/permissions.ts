import type { AgentPolicy } from '../../src/policy/policy.interface';
import { ClaudeProvider } from '../../src/providers/claude/claude-provider';

/**
 * Todas as opções possíveis de uma política de agente (`AgentPolicy`),
 * preenchidas de exemplo: as oito categorias, todas as operações, `ignores`
 * e os três destinos. É o vocabulário de qualquer agente, sem pensar em
 * provider: cada provider traduz isto para a sua linguagem.
 *
 * Como a decisão é tomada:
 * - para cada ação, procura uma regra que case em `allow`, `requireApproval`
 *   e `deny`; se mais de uma casar, vale a mais restritiva
 *   (deny > requireApproval > allow);
 * - se nenhuma casar, vale `default`;
 * - `ignores` tira casos de uma regra: o que está em `ignores` não casa com
 *   aquela regra (outra regra ainda pode casar).
 *
 * Padrões:
 * - caminhos, domínios, hosts, ferramentas, agentes, canais e segredos:
 *   `*` (um nível) e `**` (qualquer profundidade);
 * - comandos: só texto e `*` (qualquer coisa, inclusive espaços);
 * - `'*'` em `operations` vale todas as operações da categoria.
 */
export const todasAsPermissoes: AgentPolicy = {
  /** Quando nenhuma regra casa: 'allow', 'deny' ou 'require_approval'. */
  default: 'deny',

  /** Liberado sem perguntar. */
  allow: {
    filesystem: [
      {
        // 'read', 'write' ou '*'.
        operations: ['read', 'write'],
        // `/workspace` é a raiz do workspace, onde quer que ela esteja.
        paths: ['/workspace/**'],
        ignores: {
          paths: ['/workspace/.git/**', '/workspace/node_modules/**'],
        },
      },
      {
        operations: ['read'],
        paths: ['/workspace/.git/**', '/workspace/node_modules/**'],
      },
    ],
    web: [
      {
        // 'search', 'read_text', 'interact', 'form_submit', 'login',
        // 'browse' ou '*'.
        operations: ['search', 'read_text'],
        domains: ['*'],
        ignores: { domains: ['google.com', '*.google.com'] },
      },
      {
        operations: ['browse', 'interact'],
        domains: ['github.com', '*.github.com'],
      },
    ],
    network: [
      {
        // 'connect' ou '*'. Vale para qualquer programa (curl, npm, git).
        operations: ['connect'],
        // Host, com ou sem porta.
        hosts: [
          'registry.npmjs.org',
          'github.com',
          '*.github.com',
          'localhost:3000',
        ],
        ignores: { hosts: ['gist.github.com'] },
      },
    ],
    execution: [
      {
        commands: [
          'bun *',
          'npm *',
          'npx *',
          'bunx *',
          'git status',
          'git diff *',
        ],
        ignores: { commands: ['npm publish', 'npm publish *'] },
      },
      {
        commands: ['ls *', 'cat *', 'find *', 'pwd', 'mkdir *'],
      },
    ],
    tools: [
      {
        // 'call' ou '*'. Ferramentas externas (MCP): `servidor/ferramenta`.
        operations: ['call'],
        tools: ['github/*', 'docs/search'],
        ignores: { tools: ['github/delete_repository'] },
      },
    ],
    agents: [
      {
        // 'spawn' ou '*'. Subagentes, pelo nome ou pelo modelo.
        operations: ['spawn'],
        agents: ['revisor', 'claude-haiku-*'],
        ignores: { agents: ['claude-haiku-4-*'] },
      },
    ],
    communication: [
      {
        // 'send_email', 'post_social_media', 'send_logs' ou '*'.
        operations: ['send_logs'],
        channels: ['logs.interno.exemplo'],
      },
    ],
    secrets: [
      {
        // 'read' ou '*'. Variáveis de ambiente e credenciais, pelo nome.
        operations: ['read'],
        secrets: ['NODE_ENV', 'PORT', 'DATABASE_*'],
        ignores: { secrets: ['DATABASE_PASSWORD'] },
      },
    ],
  },

  /** Pergunta antes (o `approve` do agente decide; por padrão, você). */
  requireApproval: {
    filesystem: [
      {
        operations: ['write'],
        paths: ['/workspace/package.json', '/workspace/*.lock'],
      },
    ],
    web: [
      {
        operations: ['form_submit', 'login'],
        domains: ['*'],
        ignores: { domains: ['localhost'] },
      },
    ],
    network: [
      {
        operations: ['connect'],
        hosts: ['*'],
        ignores: { hosts: ['localhost', 'localhost:*'] },
      },
    ],
    execution: [
      {
        commands: ['git commit *', 'git push *', 'rm *', 'mv *'],
        ignores: { commands: ['rm -rf *'] },
      },
    ],
    tools: [
      {
        operations: ['*'],
        tools: ['*/create_*', '*/update_*'],
      },
    ],
    agents: [
      {
        operations: ['spawn'],
        agents: ['claude-opus-*', 'claude-fable-*'],
      },
    ],
    communication: [
      {
        operations: ['send_email'],
        channels: ['*@empresa.exemplo'],
      },
    ],
    secrets: [
      {
        operations: ['read'],
        secrets: ['DATABASE_PASSWORD'],
      },
    ],
  },

  /** Sempre negado, mesmo que outra regra libere. */
  deny: {
    filesystem: [
      {
        operations: ['*'],
        paths: ['/workspace/.env', '/workspace/.env.*'],
        ignores: { paths: ['/workspace/.env.example'] },
      },
    ],
    web: [
      {
        operations: ['*'],
        domains: ['malware.exemplo', '*.malware.exemplo'],
      },
    ],
    network: [
      {
        operations: ['*'],
        hosts: ['169.254.169.254', 'metadata.google.internal'],
      },
    ],
    execution: [
      {
        commands: [
          'sudo *',
          'rm -rf *',
          'curl * | sh',
          'npm publish',
          'npm publish *',
        ],
      },
    ],
    tools: [
      {
        operations: ['*'],
        tools: ['*/delete_*'],
      },
    ],
    agents: [
      {
        operations: ['*'],
        agents: ['*'],
        ignores: { agents: ['revisor', 'claude-*'] },
      },
    ],
    communication: [
      {
        operations: ['post_social_media'],
        channels: ['*'],
      },
    ],
    secrets: [
      {
        operations: ['*'],
        secrets: ['*_TOKEN', '*_KEY', '*_SECRET'],
      },
    ],
  },
};

export const claudePermissoes = new ClaudeProvider({
  model: 'claude-haiku-5-5',
}).buildPermissions(todasAsPermissoes);

console.log(claudePermissoes);

// const codexPermissoes = todasAsPermissoes;
// const cursorPermissoes = todasAsPermissoes;
// const ollamaClaudePermissoes = todasAsPermissoes;
// const ollamaCodexPermissoes = todasAsPermissoes;
