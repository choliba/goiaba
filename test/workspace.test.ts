import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { ProgramCommand } from '../src/execute/types';
import { UsageError } from '../src/usage';
import {
  BubblewrapSandbox,
  bubblewrapEnterCommand,
  bubblewrapJailArgs,
  resolveBubblewrapPid,
} from '../src/workspace/sandbox/bubblewrap';
import {
  DEFAULT_DOCKER_IMAGE,
  DockerSandbox,
} from '../src/workspace/sandbox/docker';
import { Workspace } from '../src/workspace/index';

const root = '/home/dev/dev/goiaba';

const command: ProgramCommand = {
  executable: 'agent',
  arguments: ['--print', 'analise'],
  input: 'prompt do agente',
};

/** What `docker run --pull` gets for `image`. */
async function pullOf(image: string): Promise<string | undefined> {
  const args =
    (await new Workspace({ type: 'docker', root, image }).prepare(command))
      .arguments ?? [];
  return args.at(args.indexOf('--pull') + 1);
}

describe('Workspace', () => {
  test('rejeita uma raiz vazia', () => {
    expect(
      () =>
        new Workspace({
          type: 'bubblewrap',
          root: '   ',
        }),
    ).toThrow('A raiz do workspace não pode estar vazia.');
  });

  test('rejeita imagem Docker inválida e sugere um exemplo', () => {
    const message = `A imagem do workspace Docker deve ser FROM <imagem> (do Docker Hub) ou <imagem> (construída nesta máquina). Exemplo:\n\n  ${DEFAULT_DOCKER_IMAGE}`;

    for (const image of ['', 'oven/bun latest', 'FROM']) {
      const create = (): Workspace =>
        new Workspace({ type: 'docker', root, image });

      expect(create).toThrow(UsageError);
      expect(create).toThrow(message);
    }
  });

  test('docker: FROM baixa do registry se faltar; sem FROM, só a imagem local', async () => {
    expect(await pullOf('FROM oven/bun:latest')).toBe('missing');
    expect(await pullOf('goiaba-agent:latest')).toBe('never');
  });

  test('docker envolve o comando em docker run', async () => {
    const image = 'goiaba-agent:latest';
    const workspace = new Workspace({
      type: 'docker',
      root,
      image: `FROM ${image}`,
    });
    const prepared = await workspace.prepare(command);
    const args = prepared.arguments ?? [];
    const imageIndex = args.lastIndexOf(image);
    const envNames: string[] = [];

    for (let index = 0; index < imageIndex; index += 1) {
      if (args[index] === '-e') {
        const value = args.at(index + 1);

        if (value !== undefined && !value.includes('=')) {
          envNames.push(value);
        }
      }
    }

    expect(prepared.executable).toBe('docker');
    expect(prepared.cwd).toBe(root);
    expect(prepared.input).toBe(command.input);
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '-i']);
    expect(args[3]).toBe('--name');
    expect(args[4]).toMatch(/^goiaba-[0-9a-f]{8}$/);
    expect(args.slice(5, 9)).toEqual([
      '--network',
      'host',
      '--cap-add',
      'SYS_CHROOT',
    ]);
    expect(args).toContain('/:/host:ro');
    expect(args).toContain(`${root}:/host${root}`);
    expect(args).toContain('/host/tmp');
    expect(args).toContain(`/host${root}`);
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex)).toEqual([
      image,
      'chroot',
      '/host',
      ...innerUserArgs(),
      '/usr/bin/env',
      `--chdir=${root}`,
      'agent',
      '--print',
      'analise',
    ]);

    for (const name of Object.keys(process.env)) {
      if (process.env[name] !== undefined) {
        expect(envNames).toContain(name);
      }
    }
  });

  test('docker encaminha só as variáveis definidas', async () => {
    const prepared = await new DockerSandbox({
      image: 'FROM goiaba-agent:latest',
      root,
      env: { TOKEN: 'secret', EMPTY: undefined },
    }).prepare({ ...command, cwd: root });
    const args = prepared.arguments ?? [];

    expect(args).toContain('TOKEN');
    expect(args[args.indexOf('TOKEN') - 1]).toBe('-e');
    expect(args).not.toContain('EMPTY');
  });

  test('docker deixa gravável o estado dos CLIs em HOME', async () => {
    const home = mkdtempSync(join(tmpdir(), 'goiaba-home-'));
    const cursor = join(home, '.cursor');
    const codex = join(home, '.codex');
    mkdirSync(cursor);
    mkdirSync(codex);

    try {
      const prepared = await new DockerSandbox({
        image: 'FROM goiaba-agent:latest',
        root,
        env: { HOME: home },
      }).prepare({ ...command, cwd: root });
      const args = prepared.arguments ?? [];

      expect(args).toContain(`${cursor}:/host${cursor}`);
      expect(args).toContain(`${codex}:/host${codex}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('docker compila máscara negada depois do workspace', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
    const denied = join(workspaceRoot, '.env');
    writeFileSync(denied, 'SEGREDO');
    const workspace = new Workspace({
      type: 'docker',
      root: workspaceRoot,
      image: 'FROM oven/bun:latest',
    });

    try {
      workspace.applyPermissions({
        default: 'deny',
        allow: {
          filesystem: [
            {
              operations: ['read', 'write'],
              paths: ['/workspace/**'],
            },
          ],
        },
        deny: {
          filesystem: [
            {
              operations: ['read', 'write'],
              paths: ['/workspace/.env'],
            },
          ],
        },
      });

      const prepared = await workspace.prepare(command);
      expect(prepared.arguments).toContain(`/dev/null:/host${denied}:ro`);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test.skipIf(Bun.which('bwrap') === null || Bun.which('nsenter') === null)(
    'bubblewrap envolve o comando em nsenter na jaula persistente',
    async () => {
      const workspace = new Workspace({
        type: 'bubblewrap',
        root,
      });

      try {
        const prepared = await workspace.prepare(command);
        const args = prepared.arguments ?? [];
        const pid = nsenterTarget(args);

        expect(prepared.executable).toBe('nsenter');
        expect(prepared.cwd).toBe(root);
        expect(prepared.input).toBe(command.input);
        expect(args).toEqual([
          '--preserve-credentials',
          '-t',
          String(pid),
          '-m',
          '-U',
          '-i',
          '-u',
          '-p',
          `--wdns=${root}`,
          '--',
          'agent',
          '--print',
          'analise',
        ]);
        expect(existsSync(`/proc/${String(pid)}/ns/user`)).toBe(true);

        const again = await workspace.prepare(command);
        expect(nsenterTarget(again.arguments ?? [])).toBe(pid);

        const entered = spawnSync(
          'nsenter',
          [
            '--preserve-credentials',
            '-t',
            String(pid),
            '-m',
            '-U',
            '-i',
            '-u',
            '-p',
            `--wdns=${root}`,
            '--',
            '/bin/true',
          ],
          { encoding: 'utf8' },
        );

        expect({ status: entered.status, stderr: entered.stderr }).toEqual({
          status: 0,
          stderr: '',
        });
      } finally {
        await workspace.close();
      }
    },
  );

  test('recusa / como raiz: seria escrita no sistema inteiro', () => {
    for (const type of ['bubblewrap', 'docker'] as const) {
      expect(
        () =>
          new Workspace(
            type === 'docker'
              ? { type, root: '/', image: 'FROM oven/bun:latest' }
              : { type, root: '/' },
          ),
      ).toThrow('A raiz do workspace não pode ser /');
    }
  });

  test('bubblewrap não monta o filesystem do host inteiro', () => {
    const args = bubblewrapJailArgs(root, [root]);

    expect(args).toContain('/usr');
    expect(args[args.indexOf('/usr') - 1]).toBe('--ro-bind');
    expect(args).not.toContain('/');
  });

  test.skipIf(Bun.which('bwrap') === null || Bun.which('nsenter') === null)(
    'bubblewrap esconde o diretório pai do root',
    async () => {
      // A parent with files that must stay hidden, outside the repository.
      const parent = mkdtempSync(join(tmpdir(), 'goiaba-parent-'));
      writeFileSync(join(parent, 'goiaba.config.ts'), '');
      writeFileSync(join(parent, 'package.json'), '{}');
      const jailRoot = join(parent, 'app');
      mkdirSync(jailRoot);
      const workspace = new Workspace({
        type: 'bubblewrap',
        root: jailRoot,
      });

      try {
        const prepared = await workspace.prepare(command);
        const pid = nsenterTarget(prepared.arguments ?? []);
        const listing = spawnSync(
          'nsenter',
          [
            '--preserve-credentials',
            '-t',
            String(pid),
            '-m',
            '-U',
            '-i',
            '-u',
            `--wd=${jailRoot}`,
            '--',
            '/bin/ls',
            join(jailRoot, '..'),
          ],
          { encoding: 'utf8' },
        );

        expect(listing.status).toBe(0);
        expect(listing.stdout).not.toContain('goiaba.config.ts');
        expect(listing.stdout).not.toContain('package.json');
        expect(listing.stdout.split(/\s+/)).toContain('app');
      } finally {
        await workspace.close();
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  test('bubblewrap monta o comando nsenter para entrar na jaula', () => {
    expect(bubblewrapEnterCommand(4242, root)).toBe(
      `nsenter --preserve-credentials -t 4242 -m -U -i -u --wdns=${root} -- env 'PS1=(jaula) \\w \\$ ' /bin/bash --norc -i`,
    );
  });

  test.skipIf(Bun.which('bwrap') === null || Bun.which('nsenter') === null)(
    'bubblewrap resolve pid entra na jaula com nsenter',
    async () => {
      const child = spawn(
        'bwrap',
        [
          '--die-with-parent',
          '--unshare-all',
          '--share-net',
          '--ro-bind',
          '/',
          '/',
          '--dev',
          '/dev',
          '--proc',
          '/proc',
          '--tmpfs',
          '/tmp',
          '--bind',
          root,
          root,
          '--chdir',
          root,
          'sleep',
          '30',
        ],
        { stdio: 'ignore' },
      );

      try {
        const parentPid = child.pid;

        if (parentPid === undefined) {
          throw new Error('bwrap sem pid');
        }

        // Wait until the jail is set up, as the sandbox does.
        const pid = await resolveBubblewrapPid(parentPid, {
          cwd: root,
          command: 'sleep',
        });

        if (pid === undefined) {
          throw new Error('filho da jaula não encontrado');
        }

        expect(pid).not.toBe(parentPid);

        const entered = spawnSync(
          'nsenter',
          [
            '--preserve-credentials',
            '-t',
            String(pid),
            '-m',
            '-U',
            '-i',
            '-u',
            `--wd=${root}`,
            '--',
            '/bin/true',
          ],
          { encoding: 'utf8' },
        );

        expect(entered.status).toBe(0);

        const parentEnter = spawnSync(
          'nsenter',
          [
            '--preserve-credentials',
            '-t',
            String(parentPid),
            '-m',
            '-U',
            '-i',
            '-u',
            `--wd=${root}`,
            '--',
            '/bin/true',
          ],
          { encoding: 'utf8' },
        );

        expect(parentEnter.status).not.toBe(0);
      } finally {
        child.kill('SIGKILL');
        await new Promise<void>((resolve) => {
          child.once('close', () => resolve());
        });
      }
    },
  );

  test.skipIf(Bun.which('bwrap') === null)(
    'bubblewrap mascara arquivo negado pela política',
    async () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'goiaba-policy-'));
      writeFileSync(join(workspaceRoot, '.env'), 'SEGREDO');
      writeFileSync(join(workspaceRoot, 'public.txt'), 'PUBLICO');
      const workspace = new Workspace({
        type: 'bubblewrap',
        root: workspaceRoot,
      });

      try {
        workspace.applyPermissions({
          default: 'deny',
          allow: {
            filesystem: [
              {
                operations: ['read', 'write'],
                paths: ['/workspace/**'],
              },
            ],
          },
          deny: {
            filesystem: [
              {
                operations: ['read', 'write'],
                paths: ['/workspace/.env'],
              },
            ],
          },
        });

        const prepared = await workspace.prepare({
          executable: process.execPath,
          arguments: [
            '-e',
            "const fs=require('fs');let secret;try{secret=fs.readFileSync('.env','utf8')}catch{secret='DENIED'}process.stdout.write(fs.readFileSync('public.txt','utf8')+'|'+secret)",
          ],
        });
        const result = spawnSync(
          prepared.executable,
          [...(prepared.arguments ?? [])],
          { cwd: prepared.cwd, encoding: 'utf8' },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('PUBLICO|DENIED');
        expect(result.stdout).not.toContain('SEGREDO');
      } finally {
        await workspace.close();
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(Bun.which('bwrap') === null)(
    'bubblewrap deixa gravável o estado dos CLIs em HOME',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'goiaba-home-'));
      const cursor = join(home, '.cursor');
      const config = join(home, '.config');
      mkdirSync(cursor);
      mkdirSync(config);
      const sandbox = new BubblewrapSandbox({
        root,
        env: { HOME: home },
      });

      try {
        const prepared = await sandbox.prepare({ ...command, cwd: root });
        const pid = nsenterTarget(prepared.arguments ?? []);
        const cmdline = readFileSync(
          `/proc/${String(pid)}/cmdline`,
          'utf8',
        ).replaceAll('\0', ' ');

        expect(cmdline).toContain(cursor);
        expect(cmdline).toContain(config);
      } finally {
        await sandbox.close();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});

function nsenterTarget(args: readonly string[]): number {
  const index = args.indexOf('-t');
  const pid = Number(args[index + 1]);

  if (index < 0 || !Number.isInteger(pid)) {
    throw new Error('comando nsenter sem pid');
  }

  return pid;
}

function innerUserArgs(): readonly string[] {
  const uid = process.getuid?.();
  const gid = process.getgid?.();

  if (uid === undefined || gid === undefined || uid === 0) {
    return [];
  }

  return [
    '/usr/bin/setpriv',
    `--reuid=${uid}`,
    `--regid=${gid}`,
    '--init-groups',
    '--',
  ];
}
