/**
 * What a policy lets an agent change in the workspace, as rounds read it.
 * Pure, without other modules' runtime code: the pages use it too.
 */

import type { AgentPolicy } from '../policy/policy.interface';

/**
 * Where a policy lets the agent write, relative to the workspace's root:
 * each filesystem `allow` with `write`, as `tickets/**`. A path outside
 * `/workspace` is not the workspace's, and stays out.
 */
export function writableOf(policy: AgentPolicy | null): string[] {
  return (policy?.allow?.filesystem ?? [])
    .filter((rule) =>
      rule.operations.some((op) => op === 'write' || op === '*'),
    )
    .flatMap((rule) => rule.paths)
    .filter((path) => path.startsWith('/workspace/'))
    .map((path) => path.slice('/workspace/'.length));
}

/** The path of a `git status --porcelain` line; a rename's new name. */
export function statusPath(line: string): string {
  const path = line.slice(3);
  const renamed = path.indexOf(' -> ');
  return renamed === -1 ? path : path.slice(renamed + ' -> '.length);
}
