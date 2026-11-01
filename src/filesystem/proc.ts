import {
  canOpen,
  listDirectory,
  pathExists,
  readLink,
  readText,
} from './index';

/** Inspection of other processes through /proc (Linux). */

export function processName(pid: number): string | undefined {
  try {
    return readText(`/proc/${String(pid)}/comm`).trim();
  } catch {
    return undefined;
  }
}

export function processCwd(pid: number): string | undefined {
  try {
    return readLink(`/proc/${String(pid)}/cwd`);
  } catch {
    return undefined;
  }
}

export function processChildren(pid: number): number[] {
  const pids = new Set<number>();
  const taskDir = `/proc/${String(pid)}/task`;
  let tasks: string[];

  try {
    tasks = listDirectory(taskDir);
  } catch {
    return [];
  }

  for (const task of tasks) {
    try {
      const children = readText(`${taskDir}/${task}/children`)
        .trim()
        .split(/\s+/)
        .filter((value) => value.length > 0);

      for (const child of children) {
        pids.add(Number(child));
      }
    } catch {
      // The task went away while the process was still starting.
    }
  }

  return [...pids];
}

export function processNamespace(
  pid: number,
  kind: string,
): string | undefined {
  try {
    return readLink(`/proc/${String(pid)}/ns/${kind}`);
  } catch {
    return undefined;
  }
}

/** Whether this process may join `pid`'s user namespace (nsenter -U). */
export function canEnterUserNamespace(pid: number): boolean {
  return canOpen(`/proc/${String(pid)}/ns/user`);
}

/** Whether a process with this pid is still running. */
export function processAlive(pid: number): boolean {
  return pathExists(`/proc/${String(pid)}`);
}
