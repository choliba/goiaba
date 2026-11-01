import { createHash } from 'node:crypto';

import { UsageError } from '../errors';
import { processAlive, processName } from '../filesystem/proc';
import { currentPid, environment } from '../execute/process';
import {
  ensureDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
  join,
  goiabaCacheDir,
} from '../filesystem/index';

interface LockOwner {
  readonly pid: number;
  /** Process name when it took the lock: a reused pid is not the owner. */
  readonly command: string | undefined;
  readonly agent: string;
  readonly root: string;
  readonly startedAt: string;
}

/**
 * One running agent per workspace across programs: two runs on the same
 * files and the same local model only wait on each other. A lock left by a
 * program that died is taken over; agents in the same program share it.
 */
export class WorkspaceLock {
  private readonly path: string;
  private held = false;

  public constructor(
    private readonly root: string,
    private readonly agent: string,
  ) {
    const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
    this.path = join(goiabaCacheDir(environment()), 'agents', `${id}.json`);
  }

  public acquire(): void {
    if (this.held) return;

    const owner = this.owner();
    if (owner !== undefined && owner.pid !== currentPid() && alive(owner)) {
      const since = owner.startedAt.replace('T', ' ').slice(11, 16);
      throw new UsageError(
        `Já existe um agente rodando neste workspace: ${owner.agent} (pid ${String(owner.pid)}, desde ${since} UTC). Encerre-o (kill ${String(owner.pid)}) ou use outro workspace.`,
      );
    }

    ensureDirectory(join(goiabaCacheDir(environment()), 'agents'), 0o700);
    const lock: LockOwner = {
      pid: currentPid(),
      command: processName(currentPid()),
      agent: this.agent,
      root: this.root,
      startedAt: new Date().toISOString(),
    };
    writeText(this.path, `${JSON.stringify(lock)}\n`, 0o600);
    this.held = true;
  }

  public release(): void {
    if (!this.held) return;
    this.held = false;
    if (this.owner()?.pid === currentPid()) removePath(this.path);
  }

  private owner(): LockOwner | undefined {
    if (!pathExists(this.path)) return undefined;

    try {
      const value: unknown = JSON.parse(readText(this.path));
      return isOwner(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

function alive(owner: LockOwner): boolean {
  if (!processAlive(owner.pid)) return false;
  // The pid may now be another program's.
  return (
    owner.command === undefined || processName(owner.pid) === owner.command
  );
}

function isOwner(value: unknown): value is LockOwner {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pid' in value &&
    typeof value.pid === 'number' &&
    'agent' in value &&
    typeof value.agent === 'string' &&
    'startedAt' in value &&
    typeof value.startedAt === 'string'
  );
}
