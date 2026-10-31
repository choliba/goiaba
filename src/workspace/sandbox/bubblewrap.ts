import { homedir } from 'node:os';

import {
  ensureDirectory,
  isDirectory,
  isSymlink,
  pathExists,
  readLink,
  join,
} from '../../filesystem/index';
import {
  canEnterUserNamespace,
  processChildren,
  processCwd,
  processName,
  processNamespace,
} from '../../execute/proc';
import {
  environment,
  goiabaCacheDir,
  startHelper,
  type Helper,
} from '../../execute/process';
import type { ProgramCommand } from '../../execute/types';
import { UsageError } from '../../errors';
import { isDebug } from '../../logger/index';
import { log } from '../../logger/index';
import { logSandbox } from './debug';
import { hostStateDirs } from './host-state';
import type { NetworkExit, Sandbox } from './types';
import type { SandboxHost } from './host-access';
import { wrapCommand } from './wrap-command';
import type { FilesystemAccess, FilesystemMask } from '../../policy/index';
import { protectedMasks } from './protect';

export interface BubblewrapSandboxOptions {
  readonly root: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly writable?: readonly string[];
}

/**
 * Keeps the jail up while Goiaba lives: it blocks reading a pipe from this
 * process, and when Goiaba dies (even by SIGKILL, without `close()`), the pipe
 * closes, `cat` exits and the jail's PID 1 takes everything inside with it.
 */
const JAIL_COMMAND = ['cat'] as const;

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
  private keeper: Helper | undefined;
  private jailPid: number | undefined;
  private starting: Promise<number> | undefined;
  private filesystem: FilesystemAccess | undefined;
  private protectedPaths: readonly string[] = [];
  private network: NetworkExit | undefined;
  private host: SandboxHost | undefined;

  public constructor({
    root,
    env = environment(),
    writable = [],
  }: BubblewrapSandboxOptions) {
    this.root = root;
    this.env = env;
    this.writable = writable;
  }

  public configureFilesystem(access: FilesystemAccess): void {
    if (this.keeper !== undefined) {
      throw new UsageError(
        'A política deve ser configurada antes da execução.',
      );
    }

    this.filesystem = access;
  }

  public protect(paths: readonly string[]): void {
    if (this.keeper !== undefined) {
      throw new UsageError(
        'Caminhos protegidos devem ser configurados antes da execução.',
      );
    }

    this.protectedPaths = [...this.protectedPaths, ...paths];
  }

  public useHost(host: SandboxHost): void {
    if (this.keeper !== undefined) {
      throw new UsageError('O host deve ser configurado antes da execução.');
    }

    this.host = host;
  }

  public isolateNetwork(exit: NetworkExit): void {
    if (this.keeper !== undefined) {
      throw new UsageError('A rede deve ser configurada antes da execução.');
    }

    this.network = exit;
  }

  public async prepare(command: ProgramCommand): Promise<ProgramCommand> {
    const pid = await this.ensureJail();
    const network = this.network;

    const prepared = wrapCommand(
      'nsenter',
      bubblewrapNsenterArgs(pid, this.root, network !== undefined),
      network === undefined
        ? command
        : wrapCommand('env', network.environment(), command),
    );
    // nsenter hands its environment to the CLI: only what was let in.
    return this.host === undefined
      ? prepared
      : { ...prepared, env: this.host.env };
  }

  public async started(pid: number | undefined): Promise<void> {
    if (!isDebug() || this.jailPid === undefined) {
      return;
    }

    log.debug({
      type: 'sandbox',
      sandbox: 'bubblewrap',
      phase: 'command',
      pid,
      childPid: this.jailPid,
      enter: bubblewrapEnterCommand(this.jailPid, this.root),
    });
  }

  public async close(): Promise<void> {
    const keeper = this.keeper;
    this.keeper = undefined;
    this.jailPid = undefined;

    await keeper?.stop();
  }

  private async ensureJail(): Promise<number> {
    if (this.jailPid !== undefined && this.keeper?.pid !== undefined) {
      return this.jailPid;
    }

    // Concurrent executions share one jail instead of each starting its own.
    this.starting ??= this.startJail().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startJail(): Promise<number> {
    // spawn reports a missing cwd as ENOENT on the executable itself.
    if (!pathExists(this.root)) {
      throw new UsageError(`A raiz do workspace não existe: ${this.root}`);
    }

    for (const path of this.host?.state ?? []) {
      // Goiaba's own cache (gate, bridge) is created here if missing.
      if (path === goiabaCacheDir()) ensureDirectory(path);
    }
    const writable = writableBinds(
      this.root,
      [
        ...(this.host?.state ?? hostStateDirs(this.env)),
        ...this.writable,
        ...(this.filesystem?.writable ?? []),
      ],
      this.filesystem?.workspaceAccess !== 'readonly',
    );
    const readonly = [
      ...bubblewrapReadonlyBinds(this.env, writable),
      ...(this.filesystem?.workspaceAccess === 'readonly' ? [this.root] : []),
    ];
    const jailArgs = [
      ...bubblewrapJailArgs(
        this.root,
        writable,
        readonly,
        this.network === undefined,
      ),
      ...bubblewrapMaskArgs([
        ...(this.filesystem?.masks ?? []),
        ...protectedMasks(this.protectedPaths),
        // Logins the provider does not use: not in the jail.
        ...(this.host?.hidden ?? []).map((path) => ({
          path,
          access: 'hidden' as const,
        })),
      ]),
    ];

    logSandbox(
      'bubblewrap',
      { executable: 'bwrap', arguments: jailArgs },
      {
        isolation: true,
        network:
          this.network === undefined
            ? { unshare: 'all', share: ['net'] }
            : { unshare: 'all', exit: 'proxy' },
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
      },
    );

    const keeper = startHelper('bwrap', [...jailArgs, ...JAIL_COMMAND], {
      cwd: this.root,
    });
    this.keeper = keeper;

    keeper.onExit(() => {
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

    const pid = await resolveBubblewrapPid(parentPid, {
      cwd: this.root,
      command: JAIL_COMMAND[0],
    });

    if (pid === undefined) {
      await this.close();
      throw new UsageError('Não foi possível entrar na jaula bubblewrap.');
    }

    try {
      await this.network?.attach((command) =>
        wrapCommand('nsenter', bubblewrapNetworkArgs(pid), command),
      );
    } catch (error) {
      await this.close();
      throw error;
    }

    this.jailPid = pid;

    if (isDebug()) {
      log.debug({
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

const ROOT_SYMLINKS: readonly string[] = ['/bin', '/lib', '/lib64', '/sbin'];

export function bubblewrapReadonlyBinds(
  env: NodeJS.ProcessEnv = environment(),
  writable: readonly string[] = [],
): string[] {
  const home = env['HOME'] ?? homedir();
  const candidates = [
    '/usr',
    '/etc',
    ...OPTIONAL_SYSTEM_DIRS,
    join(home, '.local/bin'),
    join(home, '.bun'),
    ...(env['PATH'] ?? '').split(':'),
  ];
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const path of candidates) {
    if (
      path.length === 0 ||
      path === '/' ||
      ROOT_SYMLINKS.includes(path) ||
      seen.has(path) ||
      !pathExists(path) ||
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
  shareNet = true,
): string[] {
  return [
    '--die-with-parent',
    '--unshare-all',
    // Without it, the jail has only its own loopback.
    ...(shareNet ? ['--share-net'] : []),
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
    } else if (pathExists(path)) {
      args.push('--ro-bind', path, path);
    }
  }

  return args;
}

function readSymlink(path: string): string | undefined {
  try {
    if (!isSymlink(path)) {
      return undefined;
    }

    return readLink(path);
  } catch {
    return undefined;
  }
}

function coveredBy(path: string, mounts: readonly string[]): boolean {
  return mounts.some((mount) => path === mount || path.startsWith(`${mount}/`));
}

export function bubblewrapNsenterArgs(
  pid: number,
  root: string,
  ownNetwork = false,
): string[] {
  return [
    '--preserve-credentials',
    '-t',
    String(pid),
    '-m',
    '-U',
    '-i',
    '-u',
    '-p',
    // A jail sharing the host's network has none to enter.
    ...(ownNetwork ? ['-n'] : []),
    `--wdns=${root}`,
    '--',
  ];
}

/**
 * Only the jail's network (and its user namespace, which owns it): the
 * program still sees the host's files, e.g. the network bridge reaching
 * Goiaba's proxy socket.
 */
export function bubblewrapNetworkArgs(pid: number): string[] {
  return ['--preserve-credentials', '-t', String(pid), '-U', '-n', '--'];
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
/**
 * Inner bwrap process of the jail. With `ready`, also waits until the jail is
 * set up: the process sits in `cwd` and already runs `command`. Entering it
 * earlier makes nsenter fail with "cannot open current working directory".
 */
export async function resolveBubblewrapPid(
  parentPid: number,
  ready?: { readonly cwd: string; readonly command: string },
): Promise<number | undefined> {
  const hostUser = processNamespace(parentPid, 'user');

  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const pid of processChildren(parentPid)) {
      const user = processNamespace(pid, 'user');

      if (
        user !== undefined &&
        user !== hostUser &&
        canEnterUserNamespace(pid) &&
        (ready === undefined || isJailReady(pid, ready))
      ) {
        return pid;
      }
    }

    await delay(20);
  }

  return undefined;
}

function isJailReady(
  pid: number,
  ready: { readonly cwd: string; readonly command: string },
): boolean {
  return (
    processCwd(pid) === ready.cwd &&
    processChildren(pid).some((child) => processName(child) === ready.command)
  );
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
    if (seen.has(path) || !pathExists(path)) {
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
    return isDirectory(path)
      ? ['--tmpfs', path]
      : ['--ro-bind', '/dev/null', path];
  });
}
