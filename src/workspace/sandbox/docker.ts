import { execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, statSync } from 'node:fs';

import type { ProgramCommand } from '../../execute/types.js';
import { UsageError } from '../../errors.js';
import { debug, isDebug } from '../../log/index.js';
import { logSandbox } from './debug.js';
import { hostStateDirs } from './host-state.js';
import type { Sandbox } from './types.js';
import { wrapCommand } from './wrap-command.js';
import type { FilesystemAccess } from '../../policy/index.js';

export interface DockerSandboxOptions {
  readonly image: string;
  readonly root: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly writable?: readonly string[];
}

export const DEFAULT_DOCKER_IMAGE = 'FROM oven/bun:latest';

const HOST_ROOT = '/host';
const FROM_IMAGE = /^FROM\s+(\S+)$/i;
const execFileAsync = promisify(execFile);

/**
 * Jails the host executable inside the image: the host filesystem is read-only,
 * except for the workspace root and generic CLI state directories.
 */
export class DockerSandbox implements Sandbox {
  private readonly image: string;
  private readonly root: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly writable: readonly string[];
  private containerName: string | undefined;
  private filesystem: FilesystemAccess | undefined;

  public constructor({
    image,
    root,
    env = process.env,
    writable = [],
  }: DockerSandboxOptions) {
    this.image = readDockerImage(image);
    this.root = root;
    this.env = env;
    this.writable = writable;
  }

  public configureFilesystem(access: FilesystemAccess): void {
    this.filesystem = access;
  }

  public prepare(command: ProgramCommand): ProgramCommand {
    const envNames = Object.keys(this.env)
      .filter((name) => this.env[name] !== undefined)
      .sort();
    const envArgs = envNames.flatMap((name) => ['-e', name]);
    const innerRoot = `${HOST_ROOT}${this.root}`;
    const mounts = describeMounts(this.root, innerRoot, [
      ...hostStateDirs(this.env),
      ...this.writable,
    ], this.filesystem);
    const containerName = `goiaba-${randomUUID().slice(0, 8)}`;
    this.containerName = containerName;
    const uid = process.getuid?.();
    const gid = process.getgid?.();

    logSandbox('docker', command, {
      isolation: true,
      image: this.image,
      container: { name: containerName, autoRemove: true, interactive: true },
      network: { mode: 'host' },
      workingDir: innerRoot,
      mounts,
      volumes: mounts
        .filter((mount) => mount.type === 'bind')
        .map((mount) => `${mount.source}:${mount.destination}:${mount.mode ?? 'rw'}`),
      capabilities: ['SYS_CHROOT'],
      user: { uid, gid },
      env: envNames,
      chroot: HOST_ROOT,
      chdir: this.root,
    });

    return wrapCommand(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--name',
        containerName,
        '--network',
        'host',
        '--cap-add',
        'SYS_CHROOT',
        ...volumeArgs(mounts),
        '-w',
        innerRoot,
        ...envArgs,
        this.image,
        'chroot',
        HOST_ROOT,
        ...innerUserCommand(),
        '/usr/bin/env',
        `--chdir=${this.root}`,
      ],
      command,
    );
  }

  public async started(process: ChildProcess): Promise<void> {
    if (!isDebug()) {
      return;
    }

    debug({
      type: 'sandbox',
      sandbox: 'docker',
      phase: 'process',
      pid: process.pid,
      container: { name: this.containerName },
    });

    if (this.containerName === undefined) {
      return;
    }

    const inspect = await inspectContainer(this.containerName);

    debug({
      type: 'sandbox',
      sandbox: 'docker',
      phase: 'inspect',
      container: { name: this.containerName },
      ...(inspect === undefined
        ? { error: 'container não encontrado' }
        : inspect),
    });
  }
}

interface Mount {
  readonly type: string;
  readonly source?: string;
  readonly destination: string;
  readonly mode?: string;
}

function describeMounts(
  root: string,
  innerRoot: string,
  extra: readonly string[],
  filesystem?: FilesystemAccess,
): Mount[] {
  const mounts: Mount[] = [
    { type: 'bind', source: '/', destination: HOST_ROOT, mode: 'ro' },
    {
      type: 'bind',
      source: root,
      destination: innerRoot,
      mode: filesystem?.workspaceAccess === 'readonly' ? 'ro' : 'rw',
    },
  ];
  const seen = new Set([root]);

  for (const path of extra) {
    if (seen.has(path) || !existsSync(path)) {
      continue;
    }

    seen.add(path);
    mounts.push({
      type: 'bind',
      source: path,
      destination: `${HOST_ROOT}${path}`,
      mode: 'rw',
    });
  }

  mounts.push({ type: 'tmpfs', destination: `${HOST_ROOT}/tmp` });

  for (const mask of filesystem?.masks ?? []) {
    const destination = `${HOST_ROOT}${mask.path}`;

    if (mask.access === 'readonly') {
      mounts.push({
        type: 'bind',
        source: mask.path,
        destination,
        mode: 'ro',
      });
    } else if (statSync(mask.path).isDirectory()) {
      mounts.push({ type: 'tmpfs', destination });
    } else {
      mounts.push({
        type: 'bind',
        source: '/dev/null',
        destination,
        mode: 'ro',
      });
    }
  }
  return mounts;
}

function volumeArgs(mounts: readonly Mount[]): string[] {
  const args: string[] = [];

  for (const mount of mounts) {
    if (mount.type === 'tmpfs') {
      args.push('--tmpfs', mount.destination);
      continue;
    }

    if (mount.source === undefined) {
      continue;
    }

    const spec =
      mount.mode === 'ro'
        ? `${mount.source}:${mount.destination}:ro`
        : `${mount.source}:${mount.destination}`;
    args.push('-v', spec);
  }

  return args;
}

function innerUserCommand(): readonly string[] {
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

function readDockerImage(image: string): string {
  const match = FROM_IMAGE.exec(image.trim());

  if (match === null) {
    throw new UsageError(
      `A imagem do workspace Docker deve ser FROM <imagem>. Exemplo:\n\n  ${DEFAULT_DOCKER_IMAGE}`,
    );
  }

  return match[1] ?? '';
}

async function inspectContainer(
  name: string,
): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const { stdout } = await execFileAsync('docker', ['inspect', name], {
        encoding: 'utf8',
        timeout: 1000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const parsed: unknown = JSON.parse(stdout);

      if (Array.isArray(parsed)) {
        return readInspect(parsed[0]);
      }
    } catch {
      await delay(60);
    }
  }

  return undefined;
}

function readInspect(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const state = isRecord(value.State) ? value.State : {};
  const host = isRecord(value.HostConfig) ? value.HostConfig : {};
  const config = isRecord(value.Config) ? value.Config : {};
  const net = isRecord(value.NetworkSettings) ? value.NetworkSettings : {};
  const networks = isRecord(net.Networks) ? net.Networks : {};

  return {
    id: value.Id,
    name: value.Name,
    created: value.Created,
    image: value.Image,
    platform: value.Platform,
    driver: value.Driver,
    path: value.Path,
    args: value.Args,
    state: {
      status: state.Status,
      running: state.Running,
      pid: state.Pid,
      error: state.Error,
      startedAt: state.StartedAt,
    },
    config: {
      hostname: config.Hostname,
      user: config.User,
      image: config.Image,
      workingDir: config.WorkingDir,
    },
    host: {
      networkMode: host.NetworkMode,
      binds: host.Binds,
      capAdd: host.CapAdd,
      privileged: host.Privileged,
      autoRemove: host.AutoRemove,
      tmpfs: host.Tmpfs,
      runtime: host.Runtime,
      pidMode: host.PidMode,
      ipcMode: host.IpcMode,
    },
    mounts: Array.isArray(value.Mounts)
      ? value.Mounts.map(readMount)
      : [],
    network: {
      mode: host.NetworkMode,
      sandboxId: net.SandboxID,
      ipAddress: net.IPAddress,
      gateway: net.Gateway,
      macAddress: net.MacAddress,
      networks: Object.fromEntries(
        Object.entries(networks).map(([networkName, network]) => [
          networkName,
          isRecord(network)
            ? {
                networkId: network.NetworkID,
                ipAddress: network.IPAddress,
                gateway: network.Gateway,
                macAddress: network.MacAddress,
              }
            : {},
        ]),
      ),
    },
  };
}

function readMount(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return {
    type: value.Type,
    name: value.Name,
    source: value.Source,
    destination: value.Destination,
    driver: value.Driver,
    mode: value.Mode,
    rw: value.RW,
    propagation: value.Propagation,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
