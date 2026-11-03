import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PolicyEngine } from '../src/policy/index';
import { ClaudeProvider } from '../src/providers/claude/claude-provider';
import { CodexProvider } from '../src/providers/codex/codex-provider';
import { OllamaProvider } from '../src/providers/ollama-provider';
import { CursorProvider } from '../src/providers/cursor-provider';
import type { HostAccess } from '../src/providers/types';
import {
  sandboxHost,
  type SandboxHost,
} from '../src/workspace/sandbox/host-access';
import { Workspace } from '../src/workspace/index';

const bubblewrap = Bun.which('bwrap') !== null && Bun.which('nsenter') !== null;
const docker =
  Bun.which('docker') !== null &&
  Bun.spawnSync(['docker', 'image', 'inspect', 'oven/bun:latest']).exitCode ===
    0;

let home: string;
let root: string;
const original = { ...process.env };

/** A home with every login a CLI keeps, and tokens in the environment. */
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'goiaba-home-'));
  root = join(home, 'projeto');
  mkdirSync(root, { recursive: true });
  for (const [path, text] of [
    ['.claude/.credentials.json', 'arquivo-login-do-claude'],
    [
      '.claude/projects/outro-projeto/conversa.jsonl',
      'conversa-de-outro-projeto',
    ],
    ['.codex/auth.json', 'login-do-codex'],
    ['.config/gh/hosts.yml', 'token-do-github'],
    ['.cursor/mcp-auth.json', 'token-de-mcp'],
    // Another workspace's home, inside the project: never visible.
    [
      'projeto/.goiaba/homes/outro-workspace/.claude/sessao.jsonl',
      'sessao-de-outro-workspace',
    ],
  ] as const) {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(join(home, path), text);
  }
  process.env['HOME'] = home;
  delete process.env['XDG_CACHE_HOME'];
  delete process.env['XDG_CONFIG_HOME'];
  delete process.env['XDG_DATA_HOME'];
  process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'env-token-do-claude';
  process.env['GH_TOKEN'] = 'env-token-do-github';
  process.env['NODE_ENV'] = 'teste';
});

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in original)) Reflect.deleteProperty(process.env, name);
  }
  Object.assign(process.env, original);
  rmSync(home, { recursive: true, force: true });
});

/**
 * Everything the agent could look at, from inside the sandbox: through its
 * HOME, and at the host's home by its real path.
 */
function olhar(): string {
  return [
    'env',
    ...['"$HOME"', home].flatMap((base) => [
      `cat ${base}/.claude/.credentials.json`,
      `cat ${base}/.claude/projects/outro-projeto/conversa.jsonl`,
      `cat ${base}/.codex/auth.json`,
      `cat ${base}/.config/gh/hosts.yml`,
      `cat ${base}/.cursor/mcp-auth.json`,
    ]),
    `ls -a ${join(root, '.goiaba', 'homes')}`,
  ].join('; echo; ');
}

/** The sandbox's share of the host, with the homes inside the project. */
function hostOf(
  workspace: Workspace,
  access: HostAccess,
  allowSecret: (name: string) => boolean,
  provider = 'teste',
): SandboxHost {
  const homesDir = join(root, '.goiaba', 'homes');
  return sandboxHost(access, process.env, allowSecret, {
    hostState: workspace.hostState,
    provider,
    home: join(homesDir, 'este-workspace'),
    homesDir,
    root,
  });
}

async function dentro(workspace: Workspace): Promise<string> {
  const prepared = await workspace.prepare({
    executable: 'sh',
    arguments: ['-c', `${olhar()} 2>&1`],
  });
  const child = Bun.spawn(
    [prepared.executable, ...(prepared.arguments ?? [])],
    {
      cwd: prepared.cwd ?? root,
      ...(prepared.env === undefined ? {} : { env: { ...prepared.env } }),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const saida = await new Response(child.stdout).text();
  await child.exited;
  return saida;
}

/** Allows NODE_ENV only, as a `secrets` rule would. */
const soNodeEnv = (name: string): boolean =>
  new PolicyEngine({
    default: 'deny',
    allow: { secrets: [{ operations: ['read'], secrets: ['NODE_ENV'] }] },
  }).check({ category: 'secrets', operation: 'read', secret: name }).policy ===
  'allow';

describe('segredos fora da sandbox', () => {
  for (const tipo of ['bubblewrap', 'docker'] as const) {
    const disponivel = tipo === 'docker' ? docker : bubblewrap;

    test.skipIf(!disponivel)(
      `${tipo}: num agente do Ollama, nenhum segredo está lá dentro`,
      async () => {
        const workspace =
          tipo === 'docker'
            ? new Workspace({
                type: 'docker',
                root,
                image: 'FROM oven/bun:latest',
              })
            : new Workspace({ type: 'bubblewrap', root });
        const provider = new OllamaProvider({ cli: 'codex', model: 'x' });
        workspace.useHost(hostOf(workspace, provider.hostAccess(), soNodeEnv));

        try {
          const saida = await dentro(workspace);
          for (const segredo of [
            'arquivo-login-do-claude',
            'login-do-codex',
            'token-do-github',
            'env-token-do-claude',
            'env-token-do-github',
            'conversa-de-outro-projeto',
            'token-de-mcp',
            'outro-workspace',
          ]) {
            expect(saida).not.toContain(segredo);
          }
          // O que a política libera em `secrets` chega.
          expect(saida).toContain('NODE_ENV=teste');
        } finally {
          await workspace.close();
        }
      },
      30_000,
    );
  }

  test.skipIf(!bubblewrap)(
    'bubblewrap: no Claude da nuvem, só a credencial dele entra',
    async () => {
      const workspace = new Workspace({ type: 'bubblewrap', root });
      const provider = new ClaudeProvider({ model: 'x' });
      workspace.useHost(hostOf(workspace, provider.hostAccess(), () => false));

      try {
        const saida = await dentro(workspace);
        // A CLI precisa do login dela para falar com o modelo.
        expect(saida).toContain('arquivo-login-do-claude');
        expect(saida).toContain('env-token-do-claude');
        // O resto, não.
        expect(saida).not.toContain('login-do-codex');
        expect(saida).not.toContain('token-do-github');
        expect(saida).not.toContain('env-token-do-github');
        expect(saida).not.toContain('NODE_ENV=teste');
        expect(saida).not.toContain('conversa-de-outro-projeto');
      } finally {
        await workspace.close();
      }
    },
    30_000,
  );
});

describe('o estado das CLIs no host (hostState)', () => {
  test.skipIf(!bubblewrap)(
    'login (padrão): um home próprio, só o login, somente leitura',
    async () => {
      const workspace = new Workspace({ type: 'bubblewrap', root });
      const provider = new ClaudeProvider({ model: 'x' });
      const host = hostOf(workspace, provider.hostAccess(), () => false);
      workspace.useHost(host);

      try {
        const saida = await dentro(workspace);
        expect(saida).toContain(`HOME=${host.home ?? ''}`);
        // O login chega pelo home do workspace…
        expect(saida).toContain('arquivo-login-do-claude');
        // …e nada mais do estado das CLIs no host, nem os outros homes.
        expect(saida).not.toContain('conversa-de-outro-projeto');
        expect(saida).not.toContain('login-do-codex');
        expect(saida).not.toContain('token-de-mcp');
        expect(saida).not.toContain('outro-workspace');

        const escrita = await workspace.prepare({
          executable: 'sh',
          arguments: [
            '-c',
            'echo mudou > "$HOME/.claude/.credentials.json" 2>&1 || echo somente-leitura',
          ],
        });
        const child = Bun.spawn(
          [escrita.executable, ...(escrita.arguments ?? [])],
          {
            cwd: root,
            ...(escrita.env === undefined ? {} : { env: { ...escrita.env } }),
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        expect(await new Response(child.stdout).text()).toContain(
          'somente-leitura',
        );
        await child.exited;
      } finally {
        await workspace.close();
      }
    },
    30_000,
  );

  test.skipIf(!bubblewrap)(
    'none: nem o login',
    async () => {
      const workspace = new Workspace({
        type: 'bubblewrap',
        root,
        hostState: 'none',
      });
      const provider = new CursorProvider({ model: 'x' });
      process.env['CURSOR_API_KEY'] = 'chave-de-teste';
      workspace.useHost(
        hostOf(workspace, provider.hostAccess(), () => false, provider.id),
      );

      try {
        const saida = await dentro(workspace);
        expect(saida).not.toContain('arquivo-login-do-claude');
        expect(saida).not.toContain('token-de-mcp');
      } finally {
        await workspace.close();
      }
    },
    30_000,
  );

  test.skipIf(!bubblewrap)(
    'share: o estado da CLI no host, como antes',
    async () => {
      const workspace = new Workspace({
        type: 'bubblewrap',
        root,
        hostState: 'share',
      });
      const provider = new ClaudeProvider({ model: 'x' });
      workspace.useHost(hostOf(workspace, provider.hostAccess(), () => false));

      try {
        const saida = await dentro(workspace);
        expect(saida).toContain(`HOME=${home}`);
        expect(saida).toContain('conversa-de-outro-projeto');
        // Os logins de outras CLIs continuam escondidos.
        expect(saida).not.toContain('login-do-codex');
      } finally {
        await workspace.close();
      }
    },
    30_000,
  );

  test.skipIf(!docker)(
    'docker aplica login, none e share ao estado do provider',
    async () => {
      const provider = new ClaudeProvider({ model: 'x' });
      const modes = [
        { hostState: 'login' as const, expected: 'arquivo-login-do-claude' },
        { hostState: 'none' as const, expected: 'env-token-do-claude' },
        { hostState: 'share' as const, expected: 'conversa-de-outro-projeto' },
      ];

      for (const { hostState, expected } of modes) {
        const workspace = new Workspace({
          type: 'docker',
          root,
          image: 'FROM oven/bun:latest',
          hostState,
        });
        const host = hostOf(
          workspace,
          provider.hostAccess(),
          () => false,
          provider.id,
        );
        workspace.useHost(host);

        try {
          const output = await dentro(workspace);
          expect(output).toContain(expected);
          if (hostState !== 'share') {
            expect(output).not.toContain('conversa-de-outro-projeto');
          }
          if (hostState === 'login') {
            expect(output).not.toContain('login-do-codex');
            expect(output).not.toContain('token-de-mcp');
            const prepared = await workspace.prepare({
              executable: 'sh',
              arguments: [
                '-c',
                'echo mudou > "$HOME/.claude/.credentials.json" 2>&1 || echo somente-leitura',
              ],
            });
            const child = Bun.spawn(
              [prepared.executable, ...(prepared.arguments ?? [])],
              {
                cwd: root,
                ...(prepared.env === undefined
                  ? {}
                  : { env: { ...prepared.env } }),
                stdout: 'pipe',
                stderr: 'pipe',
              },
            );
            expect(await new Response(child.stdout).text()).toContain(
              'somente-leitura',
            );
            await child.exited;
          }
          if (hostState === 'share') {
            expect(output).toContain(`HOME=${home}`);
            expect(output).not.toContain('login-do-codex');
          }
        } finally {
          await workspace.close();
        }
      }
    },
    30_000,
  );

  test('none exige uma credencial de ambiente e aceita uma alternativa', () => {
    const workspace = new Workspace({
      type: 'bubblewrap',
      root,
      hostState: 'none',
    });
    const provider = new CursorProvider({ model: 'x' });
    const access = provider.hostAccess();

    delete process.env['CURSOR_API_KEY'];
    expect(() => hostOf(workspace, access, () => false, provider.id)).toThrow(
      "O provider cursor precisa de uma destas variáveis com hostState: 'none': CURSOR_API_KEY",
    );

    process.env['CURSOR_API_KEY'] = 'chave-de-teste';
    expect(
      hostOf(workspace, access, () => false, provider.id).env['CURSOR_API_KEY'],
    ).toBe('chave-de-teste');
  });

  test('none aceita qualquer uma das credenciais alternativas do Codex', () => {
    const workspace = new Workspace({
      type: 'bubblewrap',
      root,
      hostState: 'none',
    });
    const provider = new CodexProvider({ model: 'x' });
    const access = provider.hostAccess();

    delete process.env['OPENAI_API_KEY'];
    delete process.env['CODEX_API_KEY'];
    expect(() => hostOf(workspace, access, () => false, provider.id)).toThrow(
      'OPENAI_API_KEY, CODEX_API_KEY',
    );

    process.env['CODEX_API_KEY'] = 'chave-de-teste';
    expect(
      hostOf(workspace, access, () => false, provider.id).env['CODEX_API_KEY'],
    ).toBe('chave-de-teste');
  });

  test('none permite providers locais que não declaram credenciais', () => {
    const workspace = new Workspace({
      type: 'bubblewrap',
      root,
      hostState: 'none',
    });
    const provider = new OllamaProvider({ cli: 'codex', model: 'x' });
    const workspaceHome = join(root, '.goiaba/homes/este-workspace');

    expect(
      hostOf(workspace, provider.hostAccess(), () => false, provider.id).env[
        'CODEX_HOME'
      ],
    ).toBe(`${workspaceHome}/.codex`);
  });

  test('o Claude e o Codex apontam suas configurações para o home isolado', () => {
    const workspace = new Workspace({ type: 'bubblewrap', root });
    const claude = hostOf(
      workspace,
      new ClaudeProvider({ model: 'x' }).hostAccess(),
      () => false,
      'claude',
    );
    const codex = hostOf(
      workspace,
      new OllamaProvider({ cli: 'codex', model: 'x' }).hostAccess(),
      () => false,
      'ollama-codex',
    );

    expect(claude.env['CLAUDE_CONFIG_DIR']).toBe(
      `${claude.home ?? ''}/.claude`,
    );
    expect(codex.env['CODEX_HOME']).toBe(`${codex.home ?? ''}/.codex`);
    expect(existsSync(codex.env['CODEX_HOME'])).toBe(true);
  });

  test('um hostState desconhecido é recusado', () => {
    expect(
      () =>
        new Workspace({
          type: 'bubblewrap',
          root,
          // @ts-expect-error: o valor errado é o que se testa.
          hostState: 'tudo',
        }),
    ).toThrow('hostState desconhecido: tudo');
  });
});
