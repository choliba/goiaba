import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

import { UsageError } from '../errors.js';
import type {
  AgentPermissions,
  ApprovalHandler,
  ExecutionRule,
  FilesystemAccess,
  FilesystemOperation,
  FilesystemRule,
  PermissionGroups,
  PolicyAction,
  PolicyDecision,
} from './types.js';
import { validateWildmatch, wildmatch } from './wildmatch.js';

export * from './types.js';
export { wildmatch } from './wildmatch.js';

const SOURCES = [
  ['allow', 'allow'],
  ['requireApproval', 'require_approval'],
  ['deny', 'deny'],
] as const;

export class PolicyEngine {
  public constructor(private readonly permissions: AgentPermissions) {
    validatePermissions(permissions);
  }

  public check(action: PolicyAction): PolicyDecision {
    let decision: PolicyDecision | undefined;

    for (const [source, policy] of SOURCES) {
      const rules = this.permissions[source]?.[action.category] as
        | readonly Rule[]
        | undefined;
      const rule = rules?.findLast((candidate) => matchesRule(candidate, action));

      if (rule !== undefined) {
        decision = {
          policy,
          source,
          rule,
          reason: `A ação corresponde a permissions.${source}.${action.category}.`,
        };
      }
    }

    return decision ?? {
      policy: this.permissions.default,
      source: 'default',
      reason: 'Nenhuma regra corresponde à ação.',
    };
  }

  public async authorize(
    action: PolicyAction,
    approve?: ApprovalHandler,
  ): Promise<boolean> {
    const decision = this.check(action);

    if (decision.policy === 'allow') return true;
    if (decision.policy === 'deny' || approve === undefined) return false;
    return approve({ action, decision });
  }
}

type Rule = NonNullable<PermissionGroups[keyof PermissionGroups]>[number];

export function compileFilesystemAccess(
  rawPermissions: AgentPermissions,
  workspaceRoot: string,
): FilesystemAccess {
  const permissions = aliasWorkspaceRoot(rawPermissions, workspaceRoot);
  validatePermissions(permissions);
  rejectUnsupportedCategories(permissions);

  if (permissions.default !== 'deny') {
    throw new UsageError(
      'O enforcement de filesystem exige default deny.',
    );
  }

  if ((permissions.requireApproval?.filesystem?.length ?? 0) > 0) {
    throw new UsageError(
      'Aprovação de filesystem ainda não possui interceptor seguro.',
    );
  }

  const allow = permissions.allow?.filesystem ?? [];

  for (const rule of allow) {
    for (const pattern of rule.paths) {
      if (pattern !== '/workspace/**') {
        throw new UsageError(
          `O allow não pode ser compilado com segurança pela sandbox: ${pattern}`,
        );
      }
    }
  }

  const rootRead = permitsWorkspaceTree(allow, 'read');
  const rootWrite = permitsWorkspaceTree(allow, 'write');

  if (!rootRead) {
    throw new UsageError(
      'A sandbox exige allow de read para /workspace/**.',
    );
  }

  const masks = new Map<string, 'readonly' | 'hidden'>();

  for (const rule of allow) {
    for (const operation of expandedOperations(rule.operations)) {
      for (const ignored of rule.ignores?.paths ?? []) {
        addMask(masks, compileMaskPath(ignored, workspaceRoot), operation);
      }
    }
  }

  for (const rule of permissions.deny?.filesystem ?? []) {
    if ((rule.ignores?.paths?.length ?? 0) > 0) {
      throw new UsageError(
        'ignores em regras deny de filesystem ainda não são compiláveis com segurança.',
      );
    }

    for (const operation of expandedOperations(rule.operations)) {
      for (const pattern of rule.paths) {
        addMask(masks, compileMaskPath(pattern, workspaceRoot), operation);
      }
    }
  }

  return {
    workspaceAccess: rootWrite ? 'readwrite' : 'readonly',
    masks: [...masks].map(([path, access]) => ({ path, access })),
  };
}

/** Rewrites filesystem patterns written with the real root to the /workspace alias. */
function aliasWorkspaceRoot(
  permissions: AgentPermissions,
  workspaceRoot: string,
): AgentPermissions {
  const root = resolve(workspaceRoot);
  const alias = (pattern: string): string =>
    pattern === root || pattern.startsWith(`${root}/`)
      ? `/workspace${pattern.slice(root.length)}`
      : pattern;
  const aliasRules = (
    rules: readonly FilesystemRule[] | undefined,
  ): readonly FilesystemRule[] | undefined =>
    rules?.map((rule) => ({
      ...rule,
      paths: rule.paths.map(alias),
      ...(rule.ignores?.paths === undefined
        ? {}
        : { ignores: { ...rule.ignores, paths: rule.ignores.paths.map(alias) } }),
    }));
  const aliasGroups = (
    groups: PermissionGroups | undefined,
  ): PermissionGroups | undefined =>
    groups?.filesystem === undefined
      ? groups
      : { ...groups, filesystem: aliasRules(groups.filesystem) };

  return {
    ...permissions,
    allow: aliasGroups(permissions.allow),
    requireApproval: aliasGroups(permissions.requireApproval),
    deny: aliasGroups(permissions.deny),
  };
}

function permitsWorkspaceTree(
  rules: readonly FilesystemRule[],
  operation: FilesystemOperation,
): boolean {
  return rules.some(
    (rule) =>
      includesOperation(rule.operations, operation) &&
      rule.paths.includes('/workspace/**'),
  );
}

function compileMaskPath(pattern: string, root: string): string {
  if (!pattern.startsWith('/workspace/')) {
    throw new UsageError(
      `A política de filesystem só pode usar /workspace: ${pattern}`,
    );
  }

  const suffix = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;

  if (hasMagic(suffix)) {
    throw new UsageError(
      `O padrão não pode ser compilado com segurança pela sandbox: ${pattern}`,
    );
  }

  const relativePath = suffix.slice('/workspace/'.length);
  const target = resolve(root, relativePath);
  const fromRoot = relative(root, target);

  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new UsageError(`O caminho escapa do workspace: ${pattern}`);
  }

  if (!existsSync(target)) {
    throw new UsageError(
      `O caminho protegido precisa existir para ser mascarado: ${pattern}`,
    );
  }

  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  const realRelative = relative(realRoot, realTarget);

  if (realRelative.startsWith(`..${sep}`) || realRelative === '..' || isAbsolute(realRelative)) {
    throw new UsageError(`O caminho protegido é um symlink externo: ${pattern}`);
  }

  return normalize(target);
}

function hasMagic(pattern: string): boolean {
  let escaped = false;

  for (const character of pattern) {
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '*' || character === '?' || character === '[') {
      return true;
    }
  }

  return false;
}

function addMask(
  masks: Map<string, 'readonly' | 'hidden'>,
  path: string,
  operation: FilesystemOperation,
): void {
  const current = masks.get(path);
  masks.set(path, operation === 'read' || current === 'hidden' ? 'hidden' : 'readonly');
}

function expandedOperations(
  operations: readonly (FilesystemOperation | '*')[],
): readonly FilesystemOperation[] {
  return operations.includes('*')
    ? ['read', 'write']
    : operations as readonly FilesystemOperation[];
}

function rejectUnsupportedCategories(permissions: AgentPermissions): void {
  for (const source of ['allow', 'deny', 'requireApproval'] as const) {
    const groups = permissions[source];

    for (const category of ['web', 'execution', 'communication'] as const) {
      if ((groups?.[category]?.length ?? 0) > 0) {
        throw new UsageError(
          `A categoria ${category} ainda não possui enforcement seguro.`,
        );
      }
    }
  }
}

function validatePermissions(permissions: AgentPermissions): void {
  if (!['allow', 'deny', 'require_approval'].includes(permissions.default)) {
    throw new UsageError(`Política padrão inválida: ${permissions.default as string}`);
  }

  for (const [source] of SOURCES) {
    const groups = permissions[source];
    if (groups === undefined) continue;

    for (const category of ['filesystem', 'web', 'execution', 'communication'] as const) {
      for (const rule of groups[category] ?? []) {
        if (rule.operations.length === 0) {
          throw new UsageError(`Uma regra ${category} precisa ter operações.`);
        }

        for (const pattern of patternsOf(rule)) validateWildmatch(pattern);
      }
    }
  }
}

function patternsOf(rule: Rule): readonly string[] {
  if ('paths' in rule) return [...rule.paths, ...(rule.ignores?.paths ?? [])];
  if ('domains' in rule) return [...rule.domains, ...(rule.ignores?.domains ?? [])];
  if ('channels' in rule) return [...rule.channels, ...(rule.ignores?.channels ?? [])];
  const execution = rule as ExecutionRule;
  return [
    ...(execution.commands ?? []),
    ...(execution.environments ?? []),
    ...(execution.ignores?.commands ?? []),
    ...(execution.ignores?.environments ?? []),
  ];
}

function matchesRule(rule: Rule, action: PolicyAction): boolean {
  if (!includesOperation(rule.operations, action.operation)) return false;

  switch (action.category) {
    case 'filesystem':
      return 'paths' in rule &&
        matchesAny(action.path, rule.paths) &&
        !matchesAny(action.path, rule.ignores?.paths);
    case 'web':
      return 'domains' in rule &&
        matchesAny(action.domain, rule.domains) &&
        !matchesAny(action.domain, rule.ignores?.domains);
    case 'communication':
      return 'channels' in rule &&
        matchesAny(action.channel, rule.channels) &&
        !matchesAny(action.channel, rule.ignores?.channels);
    case 'execution': {
      if ('paths' in rule || 'domains' in rule || 'channels' in rule) return false;
      const execution = rule as ExecutionRule;
      const commandMatches = execution.commands === undefined ||
        (action.command !== undefined && matchesAny(action.command, execution.commands));
      const environmentMatches = execution.environments === undefined ||
        (action.environment !== undefined && matchesAny(action.environment, execution.environments));
      const ignored =
        (action.command !== undefined && matchesAny(action.command, execution.ignores?.commands)) ||
        (action.environment !== undefined && matchesAny(action.environment, execution.ignores?.environments));
      return commandMatches && environmentMatches && !ignored;
    }
  }
}

function includesOperation(
  operations: readonly string[],
  operation: string,
): boolean {
  return operations.includes('*') || operations.includes(operation);
}

function matchesAny(value: string, patterns: readonly string[] | undefined): boolean {
  return patterns?.some((pattern) => wildmatch(value, pattern)) ?? false;
}
