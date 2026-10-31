import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PolicyEngine } from '../src/policy/index';
import { ClaudeProvider } from '../src/providers/claude/claude-provider';
import { OllamaProvider } from '../src/providers/ollama-provider';
import { sandboxHost } from '../src/workspace/sandbox/host-access';
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
  mkdirSync(root);
  for (const [path, text] of [
    ['.claude/.credentials.json', 'token-do-claude'],
    ['.codex/auth.json', 'login-do-codex'],
    ['.config/gh/hosts.yml', 'token-do-github'],
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

/** Everything the agent could look at, from inside the sandbox. */
const OLHAR = [
  'env',
  'cat "$HOME/.claude/.credentials.json"',
  'cat "$HOME/.codex/auth.json"',
  'cat "$HOME/.config/gh/hosts.yml"',
].join('; echo; ');

async function dentro(workspace: Workspace): Promise<string> {
  const prepared = await workspace.prepare({
    executable: 'sh',
    arguments: ['-c', `${OLHAR} 2>&1`],
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
        workspace.useHost(
          sandboxHost(provider.hostAccess(), process.env, soNodeEnv),
        );

        try {
          const saida = await dentro(workspace);
          for (const segredo of [
            'token-do-claude',
            'login-do-codex',
            'token-do-github',
            'env-token-do-claude',
            'env-token-do-github',
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
      workspace.useHost(
        sandboxHost(provider.hostAccess(), process.env, () => false),
      );

      try {
        const saida = await dentro(workspace);
        // A CLI precisa do login dela para falar com o modelo.
        expect(saida).toContain('token-do-claude');
        expect(saida).toContain('env-token-do-claude');
        // O resto, não.
        expect(saida).not.toContain('login-do-codex');
        expect(saida).not.toContain('token-do-github');
        expect(saida).not.toContain('env-token-do-github');
        expect(saida).not.toContain('NODE_ENV=teste');
      } finally {
        await workspace.close();
      }
    },
    30_000,
  );
});
