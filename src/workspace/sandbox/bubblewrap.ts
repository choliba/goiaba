import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ProgramCommand } from '../../execute/types.js';
import { UsageError } from '../../errors.js';
import { debug, isDebug } from '../../log/index.js';
import { logSandbox } from './debug.js';
import { hostStateDirs } from './host-state.js';
import type { Sandbox } from './types.js';
import { wrapCommand } from './wrap-command.js';
import type { FilesystemAccess, FilesystemMask } from '../../policy/index.js';

export interface BubblewrapSandboxOptions {
  readonly root: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly writable?: readonly string[];
}

const JAIL_COMMAND = ['sleep', 'infinity'] as const;

/**
 * Jails the host executable: only system dirs, the workspace root and CLI
 * state are visible. The rest of the host (including the parent of `root`)
 * is not mounted.
 *
 * The bwrap process lives for the workspace, not for each CLI invocation.
 * Commands enter that jail with nsenter, so the pid in the debug log remains
 * valid while the agent is waiting for an answer.
 */
export class BubblewrapSandbox implements Sandbox {
  private readonly root: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly writable: readonly string[];
  private keeper: ChildProcess | undefined;
  private jailPid: number | undefined;
  private filesystem: FilesystemAccess | undefined;

  public constructor({
    root,
    env = process.env,
    writable = [],
  }: BubblewrapSandboxOptions) {
    this.root = root;
    this.env = env;
    this.writable = writable;
  }

  public configureFilesystem(access: FilesystemAccess): void {
    if (this.keeper !== undefined) {
      throw new UsageError('A política deve ser configurada antes da execução.');
    }

    this.filesystem = access;
  }

  public async prepare(command: ProgramCommand): Promise<ProgramCommand> {
    const pid = await this.ensureJail();

    return wrapCommand(
      'nsenter',
      bubblewrapNsenterArgs(pid, this.root),
      command,
    );
  }

  public async started(child: ChildProcess): Promise<void> {
    if (!isDebug() || this.jailPid === undefined) {
      return;
    }

    debug({
      type: 'sandbox',
      sandbox: 'bubblewrap',
      phase: 'command',
      pid: child.pid,
      childPid: this.jailPid,
      enter: bubblewrapEnterCommand(this.jailPid, this.root),
    });
  }

  public async close(): Promise<void> {
    const keeper = this.keeper;
    this.keeper = undefined;
    this.jailPid = undefined;

    if (keeper === undefined || keeper.pid === undefined) {
      return;
    }

    try {
      keeper.kill('SIGKILL');
    } catch {
      return;
    }

    await once(keeper, 'close').catch(() => undefined);
  }

  private async ensureJail(): Promise<number> {
    if (this.jailPid !== undefined && this.keeper?.pid !== undefined) {
      return this.jailPid;
    }

    const writable = writableBinds(this.root, [
      ...hostStateDirs(this.env),
      ...this.writable,
    ], this.filesystem?.workspaceAccess !== 'readonly');
    const readonly = [
      ...bubblewrapReadonlyBinds(this.env, writable),
      ...(this.filesystem?.workspaceAccess === 'readonly' ? [this.root] : []),
    ];
    const jailArgs = [
      ...bubblewrapJailArgs(this.root, writable, readonly),
      ...bubblewrapMaskArgs(this.filesystem?.masks ?? []),
    ];

    logSandbox('bubblewrap', { executable: 'bwrap', arguments: jailArgs }, {
      isolation: true,
      network: { unshare: 'all', share: ['net'] },
      workingDir: this.root,
      mounts: [
        ...readonly.map((path) => ({
          type: 'bind',
          source: path,
          destination: path,
          mode: 'ro',
        })),
        { type: 'dev', destination: '/dev' },
        { type: 'proc', destination: '/proc' },
        { type: 'tmpfs', destination: '/tmp' },
        ...writable.map((path) => ({
          type: 'bind',
          source: path,
          destination: path,
          mode: 'rw',
        })),
      ],
      volumes: writable.map((path) => `${path}:${path}:rw`),
      dieWithParent: true,
    });

    const keeper = spawn('bwrap', [...jailArgs, ...JAIL_COMMAND], {
      cwd: this.root,
      stdio: 'ignore',
    });
    this.keeper = keeper;

    keeper.once('exit', () => {
      if (this.keeper === keeper) {
        this.keeper = undefined;
        this.jailPid = undefined;
      }
    });

    const parentPid = keeper.pid;

    if (parentPid === undefined) {
      await this.close();
      throw new UsageError('Não foi possível iniciar a jaula bubblewrap.');
    }

    const pid = await resolveBubblewrapPid(parentPid);

    if (pid === undefined) {
      await this.close();
      throw new UsageError('Não foi possível entrar na jaula bubblewrap.');
    }

    this.jailPid = pid;

    if (isDebug()) {
      debug({
        type: 'sandbox',
        sandbox: 'bubblewrap',
        phase: 'process',
        pid: parentPid,
        childPid: pid,
        enter: bubblewrapEnterCommand(pid, this.root),
      });
    }

    return pid;
  }
}

const OPTIONAL_SYSTEM_DIRS = [
  '/opt',
  '/nix/store',
  '/snap',
  '/run/systemd/resolve',
] as const;

const ROOT_SYMLINKS = ['/bin', '/lib', '/lib64', '/sbin'] as const;

export function bubblewrapReadonlyBinds(
  env: NodeJS.ProcessEnv = process.env,
  writable: readonly string[] = [],
): string[] {
  const home = env.HOME ?? homedir();
  const candidates = [
    '/usr',
    '/etc',
    ...OPTIONAL_SYSTEM_DIRS,
    join(home, '.local/bin'),
    join(home, '.bun'),
    ...(env.PATH ?? '').split(':'),
  ];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const path of candidates) {
    if (
      path.length === 0 ||
      path === '/' ||
      ROOT_SYMLINKS.includes(path as (typeof ROOT_SYMLINKS)[number]) ||
      seen.has(path) ||
      !existsSync(path) ||
      coveredBy(path, writable) ||
      coveredBy(path, paths)
    ) {
      continue;
    }

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

export function bubblewrapJailArgs(
  root: string,
  writable: readonly string[],
  readonlyBinds: readonly string[] = bubblewrapReadonlyBinds(),
): string[] {
  return [
    '--die-with-parent',
    '--unshare-all',
    '--share-net',
    ...readonlyBinds.flatMap((path) => ['--ro-bind', path, path]),
    ...rootSymlinkArgs(),
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
    ...writable.flatMap((path) => ['--bind', path, path]),
    '--chdir',
    root,
  ];
}

function rootSymlinkArgs(): string[] {
  const args: string[] = [];

  for (const path of ROOT_SYMLINKS) {
    const target = readSymlink(path);

    if (target !== undefined) {
      args.push('--symlink', target, path);
    } else if (existsSync(path)) {
      args.push('--ro-bind', path, path);
    }
  }

  return args;
}

function readSymlink(path: string): string | undefined {
  try {
    if (!lstatSync(path).isSymbolicLink()) {
      return undefined;
    }

    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

function coveredBy(path: string, mounts: readonly string[]): boolean {
  return mounts.some(
    (mount) => path === mount || path.startsWith(`${mount}/`),
  );
}

export function bubblewrapNsenterArgs(pid: number, root: string): string[] {
  return [
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
  ];
}

/**
 * Interactive attach omits the PID namespace because it steals the TTY. Agent
 * commands enter it through bubblewrapNsenterArgs so /proc/self stays valid.
 */
export function bubblewrapEnterCommand(
  pid: number,
  root: string,
  shell = '/bin/bash',
): string {
  return [
    'nsenter',
    '--preserve-credentials',
    '-t',
    String(pid),
    '-m',
    '-U',
    '-i',
    '-u',
    `--wdns=${root}`,
    '--',
    'env',
    `'PS1=(jaula) \\w \\$ '`,
    shell,
    '--norc',
    '-i',
  ].join(' ');
}

/**
 * Inner bwrap process whose user namespace is the jail. The outer `bwrap`
 * stays in the host user namespace; nsenter -U on that pid cannot work.
 */
export async function resolveBubblewrapPid(
  parentPid: number,
): Promise<number | undefined> {
  const hostUser = readNamespace(parentPid, 'user');

  for (let attempt = 0; attempt < 25; attempt += 1) {
    for (const pid of readChildren(parentPid)) {
      const user = readNamespace(pid, 'user');

      if (
        user !== undefined &&
        user !== hostUser &&
        canOpenUserNamespace(pid)
      ) {
        return pid;
      }
    }

    await delay(20);
  }

  return undefined;
}

function readChildren(pid: number): number[] {
  const pids = new Set<number>();
  const taskDir = `/proc/${String(pid)}/task`;
  let tasks: string[];

  try {
    tasks = readdirSync(taskDir);
  } catch {
    return [];
  }

  for (const task of tasks) {
    try {
      const children = readFileSync(`${taskDir}/${task}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .filter((value) => value.length > 0);

      for (const child of children) {
        pids.add(Number(child));
      }
    } catch {
      // A task desapareceu enquanto a jaula ainda subia.
    }
  }

  return [...pids];
}

function readNamespace(pid: number, kind: string): string | undefined {
  try {
    return readlinkSync(`/proc/${String(pid)}/ns/${kind}`);
  } catch {
    return undefined;
  }
}

function canOpenUserNamespace(pid: number): boolean {
  try {
    closeSync(openSync(`/proc/${String(pid)}/ns/user`, 'r'));
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function writableBinds(
  root: string,
  extra: readonly string[],
  writableRoot = true,
): string[] {
  const paths = writableRoot ? [root] : [];
  const seen = new Set(paths);

  for (const path of extra) {
    if (seen.has(path) || !existsSync(path)) {
      continue;
    }

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function bubblewrapMaskArgs(masks: readonly FilesystemMask[]): string[] {
  return masks.flatMap(({ path, access }) => {
    if (access === 'readonly') return ['--ro-bind', path, path];
    return statSync(path).isDirectory()
      ? ['--tmpfs', path]
      : ['--ro-bind', '/dev/null', path];
  });
}
