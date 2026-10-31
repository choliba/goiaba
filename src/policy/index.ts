import {
  isDirectory,
  listDirectory,
  pathExists,
  realPath,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from '../filesystem/index';
import { UsageError } from '../errors';
import type {
  AgentAction,
  AgentPolicy,
  ApprovalHandler,
  FilesystemAccess,
  FilesystemOperation,
  FilesystemRule,
  PolicyCategory,
  PolicyDecision,
  PolicyGroups,
  PolicyRule,
} from './policy.interface';
import {
  commandMatches,
  parseCommand,
  validateCommandPattern,
} from './command';
import { validateWildmatch, wildmatch } from './wildmatch';

export * from './policy.interface';
export { suggestPattern } from './command';
export { wildmatch } from './wildmatch';

/** Reason of a decision taken by `default`, when no rule matched. */
export const NO_RULE_REASON = 'Nenhuma regra corresponde à ação.';

const STRICTNESS = { allow: 0, require_approval: 1, deny: 2 } as const;

/**
 * Whether `next` should replace `current` as a line's decision: a stricter
 * policy, or, at the same policy, an explicit rule over the `default` (so an
 * approval cannot mask `sudo` in one of the parts).
 */
function stricter(next: PolicyDecision, current: PolicyDecision): boolean {
  if (STRICTNESS[next.policy] !== STRICTNESS[current.policy]) {
    return STRICTNESS[next.policy] > STRICTNESS[current.policy];
  }

  return current.source === 'default' && next.source !== 'default';
}

const SOURCES = [
  ['allow', 'allow'],
  ['requireApproval', 'require_approval'],
  ['deny', 'deny'],
] as const;

export class PolicyEngine {
  public constructor(private readonly permissions: AgentPolicy) {
    validatePermissions(permissions);
  }

  public check(action: AgentAction): PolicyDecision {
    let decision: PolicyDecision | undefined;

    for (const [source, policy] of SOURCES) {
      const rules: readonly PolicyRule[] | undefined =
        this.permissions[source]?.[action.category];
      const rule = rules?.findLast((candidate) =>
        matchesRule(candidate, action),
      );

      if (rule !== undefined) {
        decision = {
          policy,
          source,
          rule,
          reason: `A ação corresponde a permissions.${source}.${action.category}.`,
        };
      }
    }

    return (
      decision ?? {
        policy: this.permissions.default,
        source: 'default',
        reason: NO_RULE_REASON,
      }
    );
  }

  /**
   * Decision for a whole shell command line: each simple command is checked
   * and the most restrictive decision wins. A permitted line with redirection
   * or substitution still needs approval, since its effect is not readable
   * from the parts.
   *
   * `approved` are patterns approved while running: allow rules above
   * `requireApproval` and the `default`, below an explicit `deny`.
   */
  public checkCommand(
    command: string,
    { approved = [] }: { readonly approved?: readonly string[] } = {},
  ): PolicyDecision {
    const { parts, complex } = parseCommand(command);

    if (parts.length === 0) {
      return { policy: 'deny', source: 'default', reason: 'Comando vazio.' };
    }

    const decisions = parts.map((part) => this.checkPart(part, approved));
    const strictest = decisions.reduce((current, next) =>
      stricter(next, current) ? next : current,
    );
    // All parts allowed and one only by an approval: the approval decided.
    const decision =
      strictest.policy === 'allow'
        ? (decisions.find((part) => part.source === 'approved') ?? strictest)
        : strictest;

    if (complex && decision.policy === 'allow') {
      return {
        ...decision,
        policy: 'require_approval',
        reason:
          'O comando tem redirecionamento, substituição ou script: o efeito não é verificável pela regra.',
      };
    }

    return decision;
  }

  private checkPart(
    command: string,
    approved: readonly string[],
  ): PolicyDecision {
    const decision = this.check({ category: 'execution', command });
    if (decision.source === 'deny' || decision.policy === 'allow') {
      return decision;
    }

    return approved.some((pattern) => commandMatches(command, pattern))
      ? {
          policy: 'allow',
          source: 'approved',
          reason: 'Coberto por uma aprovação salva.',
        }
      : decision;
  }

  public async authorize(
    action: AgentAction,
    approve?: ApprovalHandler,
  ): Promise<boolean> {
    const decision = this.check(action);

    if (decision.policy === 'allow') return true;
    if (decision.policy === 'deny' || approve === undefined) return false;
    return approve({ action, decision });
  }
}

export function compileFilesystemAccess(
  rawPermissions: AgentPolicy,
  workspaceRoot: string,
): FilesystemAccess {
  const permissions = aliasWorkspaceRoot(rawPermissions, workspaceRoot);
  validatePermissions(permissions);

  if (permissions.default !== 'deny') {
    throw new UsageError('O enforcement de filesystem exige default deny.');
  }

  if ((permissions.requireApproval?.filesystem?.length ?? 0) > 0) {
    throw new UsageError(
      'Aprovação de filesystem ainda não possui interceptor seguro.',
    );
  }

  const allow = permissions.allow?.filesystem ?? [];
  const writable: string[] = [];

  for (const rule of allow) {
    for (const pattern of rule.paths) {
      if (pattern === '/workspace/**') continue;
      // A folder of its own, only to write: mounted writable over the
      // read-only workspace. Reading is the whole tree or nothing.
      if (isWriteOnly(rule) && isFolderTree(pattern)) {
        writable.push(writableFolder(pattern, workspaceRoot));
        continue;
      }
      throw new UsageError(
        `O allow não pode ser compilado com segurança pela sandbox: ${pattern}`,
      );
    }
  }

  const rootRead = permitsWorkspaceTree(allow, 'read');
  const rootWrite = permitsWorkspaceTree(allow, 'write');

  if (!rootRead) {
    throw new UsageError('A sandbox exige allow de read para /workspace/**.');
  }

  const masks = new Map<string, 'readonly' | 'hidden'>();

  for (const rule of allow) {
    for (const operation of expandedOperations(rule.operations)) {
      for (const ignored of rule.ignores?.paths ?? []) {
        for (const path of maskPaths(ignored, workspaceRoot)) {
          addMask(masks, path, operation);
        }
      }
    }
  }

  for (const rule of permissions.deny?.filesystem ?? []) {
    // Ignored paths stay out of the mask; one that is missing has nothing to
    // keep visible.
    const kept = new Set(
      (rule.ignores?.paths ?? []).flatMap((pattern) =>
        maskPaths(pattern, workspaceRoot, { optional: true }),
      ),
    );

    for (const operation of expandedOperations(rule.operations)) {
      for (const pattern of rule.paths) {
        for (const path of maskPaths(pattern, workspaceRoot)) {
          if (kept.has(path)) continue;

          const inside = [...kept].find((ignored) =>
            ignored.startsWith(`${path}${sep}`),
          );
          if (inside !== undefined) {
            throw new UsageError(
              `Não dá para deixar ${inside} visível dentro de ${path}: a sandbox esconde a pasta inteira.`,
            );
          }
          addMask(masks, path, operation);
        }
      }
    }
  }

  return {
    workspaceAccess: rootWrite ? 'readwrite' : 'readonly',
    // The whole workspace is writable already.
    writable: rootWrite ? [] : [...new Set(writable)],
    masks: [...masks].map(([path, access]) => ({ path, access })),
  };
}

function isWriteOnly(rule: FilesystemRule): boolean {
  return (
    rule.operations.length > 0 && rule.operations.every((op) => op === 'write')
  );
}

/** `/workspace/<folder>/**`, with no pattern in the folder's name. */
function isFolderTree(pattern: string): boolean {
  return (
    pattern.startsWith('/workspace/') &&
    pattern.endsWith('/**') &&
    !hasMagic(pattern.slice(0, -3))
  );
}

function writableFolder(pattern: string, root: string): string {
  const folder = resolve(root, pattern.slice('/workspace/'.length, -3));
  // A bind needs the folder: created by whoever runs the agent, not here.
  if (!pathExists(folder) || !isDirectory(folder)) {
    throw new UsageError(
      `A pasta com escrita liberada precisa existir antes do agente: ${pattern}`,
    );
  }
  return compileMaskPath(pattern, root);
}

/** Rewrites filesystem patterns written with the real root to the /workspace alias. */
function aliasWorkspaceRoot(
  permissions: AgentPolicy,
  workspaceRoot: string,
): AgentPolicy {
  const root = resolve(workspaceRoot);
  const alias = (pattern: string): string =>
    pattern === root || pattern.startsWith(`${root}/`)
      ? `/workspace${pattern.slice(root.length)}`
      : pattern;
  const aliasRules = (
    rules: readonly FilesystemRule[],
  ): readonly FilesystemRule[] =>
    rules.map((rule) => ({
      ...rule,
      paths: rule.paths.map(alias),
      ...(rule.ignores?.paths === undefined
        ? {}
        : {
            ignores: { ...rule.ignores, paths: rule.ignores.paths.map(alias) },
          }),
    }));
  const aliasGroups = (groups: PolicyGroups): PolicyGroups =>
    groups.filesystem === undefined
      ? groups
      : { ...groups, filesystem: aliasRules(groups.filesystem) };
  const { allow, requireApproval, deny } = permissions;

  return {
    ...permissions,
    ...(allow === undefined ? {} : { allow: aliasGroups(allow) }),
    ...(requireApproval === undefined
      ? {}
      : { requireApproval: aliasGroups(requireApproval) }),
    ...(deny === undefined ? {} : { deny: aliasGroups(deny) }),
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

/**
 * The paths a mask pattern names: one path, or, for a pattern (`.env.*`,
 * `*.lock`, `config/*.json`), the files it matches when the agent starts.
 * `**` only as the last part (`dir/**`): elsewhere it would walk the whole
 * workspace.
 */
function maskPaths(
  pattern: string,
  root: string,
  { optional = false } = {},
): string[] {
  if (!pattern.startsWith('/workspace/')) {
    throw new UsageError(
      `A política de filesystem só pode usar /workspace: ${pattern}`,
    );
  }

  const tree = pattern.endsWith('/**');
  const suffix = tree ? pattern.slice(0, -3) : pattern;

  if (!hasMagic(suffix)) {
    const missing = !pathExists(
      resolve(root, suffix.slice('/workspace/'.length)),
    );
    return optional && missing ? [] : [compileMaskPath(pattern, root)];
  }
  if (suffix.includes('**')) {
    throw new UsageError(
      `A sandbox só aceita ** no fim do caminho (pasta/**): ${pattern}`,
    );
  }

  let matches = [''];
  for (const segment of suffix.slice('/workspace/'.length).split('/')) {
    matches = matches.flatMap((base) => {
      const join = (name: string): string =>
        base === '' ? name : `${base}/${name}`;
      if (!hasMagic(segment)) return [join(segment)];

      const dir = resolve(root, base);
      return isDirectory(dir)
        ? listDirectory(dir)
            .filter((name) => wildmatch(name, segment))
            .map(join)
        : [];
    });
  }

  return matches
    .filter((path) => pathExists(resolve(root, path)))
    .map((path) =>
      compileMaskPath(`/workspace/${path}${tree ? '/**' : ''}`, root),
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

  if (
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot === '..' ||
    isAbsolute(fromRoot)
  ) {
    throw new UsageError(`O caminho escapa do workspace: ${pattern}`);
  }

  if (!pathExists(target)) {
    throw new UsageError(
      `O caminho protegido precisa existir para ser mascarado: ${pattern}`,
    );
  }

  const realRoot = realPath(root);
  const realTarget = realPath(target);
  const realRelative = relative(realRoot, realTarget);

  if (
    realRelative.startsWith(`..${sep}`) ||
    realRelative === '..' ||
    isAbsolute(realRelative)
  ) {
    throw new UsageError(
      `O caminho protegido é um symlink externo: ${pattern}`,
    );
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
  masks.set(
    path,
    operation === 'read' || current === 'hidden' ? 'hidden' : 'readonly',
  );
}

function expandedOperations(
  operations: readonly (FilesystemOperation | '*')[],
): readonly FilesystemOperation[] {
  return operations.includes('*')
    ? ['read', 'write']
    : operations.filter(
        (operation): operation is FilesystemOperation => operation !== '*',
      );
}

export type DelegatedCategory = 'web' | 'execution' | 'communication';

/**
 * Categories the sandbox cannot enforce. Each provider translates them into
 * its CLI's own permission mechanism, or refuses them.
 */
export function delegatedCategories(
  permissions: AgentPolicy,
): readonly DelegatedCategory[] {
  return (['web', 'execution', 'communication'] as const).filter((category) =>
    (['allow', 'deny', 'requireApproval'] as const).some(
      (source) => (permissions[source]?.[category]?.length ?? 0) > 0,
    ),
  );
}

const CATEGORIES: readonly PolicyCategory[] = [
  'filesystem',
  'web',
  'network',
  'execution',
  'tools',
  'agents',
  'communication',
  'secrets',
];

function validatePermissions(permissions: AgentPolicy): void {
  if (!['allow', 'deny', 'require_approval'].includes(permissions.default)) {
    throw new UsageError(
      `Política padrão inválida: ${permissions.default as string}`,
    );
  }

  for (const [source] of SOURCES) {
    const groups = permissions[source];
    if (groups === undefined) continue;

    for (const category of CATEGORIES) {
      const rules: readonly PolicyRule[] = groups[category] ?? [];

      for (const rule of rules) {
        const { patterns, ignored } = targetsOf(category, rule);

        if (patterns.length === 0) {
          throw new UsageError(
            `Uma regra ${category} precisa ter ${category === 'execution' ? 'commands' : 'alvos'}.`,
          );
        }
        if ('operations' in rule && rule.operations.length === 0) {
          throw new UsageError(`Uma regra ${category} precisa ter operações.`);
        }

        for (const pattern of [...patterns, ...ignored]) {
          if (category === 'execution') validateCommandPattern(pattern);
          else validateWildmatch(pattern);
        }
      }
    }
  }
}

/** The targets of a rule in its category, and the ones it ignores. */
function targetsOf(
  category: PolicyCategory,
  rule: PolicyRule,
): {
  readonly patterns: readonly string[];
  readonly ignored: readonly string[];
} {
  const pick = (key: string): readonly string[] => {
    const value: unknown = Reflect.get(rule, key);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  };
  const ignoredBy = (key: string): readonly string[] => {
    const ignores: unknown = Reflect.get(rule, 'ignores');
    if (typeof ignores !== 'object' || ignores === null) return [];
    const value: unknown = Reflect.get(ignores, key);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  };
  const key = TARGET_KEYS[category];
  return { patterns: pick(key), ignored: ignoredBy(key) };
}

/** Where each category keeps its targets, in rules and in actions. */
const TARGET_KEYS = {
  filesystem: 'paths',
  web: 'domains',
  network: 'hosts',
  execution: 'commands',
  tools: 'tools',
  agents: 'agents',
  communication: 'channels',
  secrets: 'secrets',
} as const satisfies Readonly<Record<PolicyCategory, string>>;

/** Where each action keeps the value its rules are compared with. */
const ACTION_KEYS = {
  filesystem: 'path',
  web: 'domain',
  network: 'host',
  execution: 'command',
  tools: 'tool',
  agents: 'agent',
  communication: 'channel',
  secrets: 'secret',
} as const satisfies Readonly<Record<PolicyCategory, string>>;

function actionTarget(action: AgentAction): string {
  const value: unknown = Reflect.get(action, ACTION_KEYS[action.category]);
  return typeof value === 'string' ? value : '';
}

function matchesRule(rule: PolicyRule, action: AgentAction): boolean {
  const { patterns, ignored } = targetsOf(action.category, rule);
  const target = actionTarget(action);

  if (action.category === 'execution') {
    return (
      patterns.some((pattern) => commandMatches(target, pattern)) &&
      !ignored.some((pattern) => commandMatches(target, pattern))
    );
  }

  if (action.category === 'network') {
    return (
      'operations' in rule &&
      includesOperation(rule.operations, action.operation) &&
      patterns.some((pattern) => hostMatches(target, pattern)) &&
      !ignored.some((pattern) => hostMatches(target, pattern))
    );
  }

  return (
    'operations' in rule &&
    includesOperation(rule.operations, action.operation) &&
    matchesAny(target, patterns) &&
    !matchesAny(target, ignored)
  );
}

/**
 * `host` covers every port; `host:443` or `host:*` names the port. The
 * destination is `host:port` (a bare host only matches port-less patterns).
 */
export function hostMatches(destination: string, pattern: string): boolean {
  const target = splitHost(destination);
  const rule = splitHost(pattern);
  return (
    wildmatch(target.host, rule.host) &&
    (rule.port === undefined || wildmatch(target.port ?? '', rule.port))
  );
}

function splitHost(value: string): {
  readonly host: string;
  readonly port?: string;
} {
  const match = /^(.+):(\d+|\*)$/.exec(value);
  const host = match?.at(1);
  const port = match?.at(2);
  return host === undefined || port === undefined
    ? { host: value }
    : { host, port };
}

function includesOperation(
  operations: readonly string[],
  operation: string,
): boolean {
  return operations.includes('*') || operations.includes(operation);
}

function matchesAny(
  value: string,
  patterns: readonly string[] | undefined,
): boolean {
  return patterns?.some((pattern) => wildmatch(value, pattern)) ?? false;
}
