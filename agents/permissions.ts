import type { AgentPolicy } from '../src';

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
        // Ainda não suportado: ignorar caminho que não existe no workspace
        // (a sandbox só esconde o que já existe ao iniciar).
        // ignores: {
        //   paths: ['/workspace/.git/**', '/workspace/node_modules/**'],
        // },
      },
      // Ainda não suportado: ler o que a regra acima esconde (allow fora de /workspace/** inteiro).
      // {
      //   operations: ['read'],
      //   paths: ['/workspace/.git/**', '/workspace/node_modules/**'],
      // },
    ],
    web: [
      {
        // 'search', 'read_text', 'interact', 'form_submit', 'login',
        // 'browse' ou '*'.
        operations: ['search', 'read_text'],
        domains: ['*'],
        // ignores: { domains: ['google.com', '*.google.com'] },
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
          'localhost:5173',
          // URL não é host: use 'duckduckgo.com' e '*.duckduckgo.com'.
          // 'https://duckduckgo.com/',
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
    // Ainda não suportado: tools, agents, communication e secrets.
    // tools: [
    //   {
    //     // 'call' ou '*'. Ferramentas externas (MCP): `servidor/ferramenta`.
    //     operations: ['call'],
    //     tools: ['github/*', 'docs/search'],
    //     ignores: { tools: ['github/delete_repository'] },
    //   },
    // ],
    // agents: [
    //   {
    //     // 'spawn' ou '*'. Subagentes, pelo nome ou pelo modelo.
    //     operations: ['spawn'],
    //     agents: ['revisor', 'claude-haiku-*'],
    //     ignores: { agents: ['claude-haiku-4-*'] },
    //   },
    // ],
    // communication: [
    //   {
    //     // 'send_email', 'post_social_media', 'send_logs' ou '*'.
    //     operations: ['send_logs'],
    //     channels: ['logs.interno.exemplo'],
    //   },
    // ],
    // secrets: [
    //   {
    //     // 'read' ou '*'. Variáveis de ambiente e credenciais, pelo nome.
    //     operations: ['read'],
    //     secrets: ['NODE_ENV', 'PORT', 'DATABASE_*'],
    //     ignores: { secrets: ['DATABASE_PASSWORD'] },
    //   },
    // ],
  },

  /** Pergunta antes (o `approve` do agente decide; por padrão, você). */
  requireApproval: {
    // Ainda não suportado: requireApproval de filesystem e de web.
    // filesystem: [
    //   {
    //     operations: ['write'],
    //     paths: ['/workspace/package.json', '/workspace/*.lock'],
    //   },
    // ],
    // web: [
    //   {
    //     operations: ['form_submit', 'login'],
    //     domains: ['*'],
    //     ignores: { domains: ['localhost'] },
    //   },
    // ],
    network: [
      {
        operations: ['connect'],
        hosts: ['*'],
        ignores: {
          hosts: [
            'www.google.com.br',
            '*.google.com',
            'localhost',
            'localhost:*',
          ],
        },
      },
    ],
    execution: [
      {
        commands: ['git commit *', 'git push *', 'rm *', 'mv *'],
        ignores: { commands: ['rm -rf *'] },
      },
    ],
    // Ainda não suportado: tools, agents, communication e secrets.
    // tools: [
    //   {
    //     operations: ['*'],
    //     tools: ['*/create_*', '*/update_*'],
    //   },
    // ],
    // agents: [
    //   {
    //     operations: ['spawn'],
    //     agents: ['claude-opus-*', 'claude-fable-*'],
    //   },
    // ],
    // communication: [
    //   {
    //     operations: ['send_email'],
    //     channels: ['*@empresa.exemplo'],
    //   },
    // ],
    // secrets: [
    //   {
    //     operations: ['read'],
    //     secrets: ['DATABASE_PASSWORD'],
    //   },
    // ],
  },

  /** Sempre negado, mesmo que outra regra libere. */
  deny: {
    // Ainda não suportado: negar caminho que não existe no workspace (a
    // sandbox só esconde o que já existe ao iniciar).
    // filesystem: [
    //   {
    //     operations: ['*'],
    //     paths: ['/workspace/.env', '/workspace/.env.*'],
    //     ignores: { paths: ['/workspace/.env.example'] },
    //   },
    // ],
    web: [
      {
        operations: ['read_text'],
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
    // Ainda não suportado: tools, agents, communication e secrets.
    // tools: [
    //   {
    //     operations: ['*'],
    //     tools: ['*/delete_*'],
    //   },
    // ],
    // agents: [
    //   {
    //     operations: ['*'],
    //     agents: ['*'],
    //     ignores: { agents: ['revisor', 'claude-*'] },
    //   },
    // ],
    // communication: [
    //   {
    //     operations: ['post_social_media'],
    //     channels: ['*'],
    //   },
    // ],
    // secrets: [
    //   {
    //     operations: ['*'],
    //     secrets: ['*_TOKEN', '*_KEY', '*_SECRET'],
    //   },
    // ],
  },
};
