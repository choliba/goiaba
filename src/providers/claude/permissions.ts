import { commandMatches } from '../../policy/command';
import type {
  AgentPolicy,
  PolicyCategory,
  PolicyGroups,
} from '../../policy/policy.interface';
import { wildmatch } from '../../policy/wildmatch';
import type {
  ProviderPermissions,
  UnsupportedRule,
} from '../provider.interface';

/** Claude Code's own permission lists (`permissions` in its settings). */
export interface ClaudePermissions {
  readonly allow: readonly string[];
  readonly ask: readonly string[];
  readonly deny: readonly string[];
}

type Source = UnsupportedRule['source'];

const CATEGORY_NAMES: readonly PolicyCategory[] = [
  'filesystem',
  'web',
  'network',
  'execution',
  'tools',
  'agents',
  'communication',
  'secrets',
];

const LISTS: readonly (readonly [Source, keyof ClaudePermissions])[] = [
  ['allow', 'allow'],
  ['requireApproval', 'ask'],
  ['deny', 'deny'],
];

/** One rule of any category, as the translation reads it. */
interface AnyRule {
  readonly operations?: readonly string[];
  readonly ignores?: Readonly<Record<string, readonly string[] | undefined>>;
}

/** The targets of a rule and what it translates to, per category. */
interface Category {
  /** Every operation of the category (`*` expands to these). */
  readonly operations: readonly string[];
  readonly targets: (rule: AnyRule) => readonly string[];
  readonly ignored: (rule: AnyRule) => readonly string[];
  readonly matches: (target: string, pattern: string) => boolean;
  /** Claude rules for `targets`, or why they cannot be expressed. */
  readonly translate: (
    operations: readonly string[],
    targets: readonly string[],
    source: Source,
  ) => readonly (string | { readonly reason: string })[];
}

/**
 * An `AgentPolicy` in Claude Code's language: `allow`, `ask`
 * (requireApproval) and `deny` lists of rules such as `Read(./src/**)`,
 * `Bash(npm *)`, `WebFetch(domain:bun.sh)`, `mcp__github__*`,
 * `Agent(revisor)`. Pure: nothing is written. What Claude cannot express
 * exactly goes to `unsupported`.
 */
export function buildClaudePermissions(
  policy: AgentPolicy,
): ProviderPermissions<ClaudePermissions> {
  const lists = {
    allow: new Set<string>(),
    ask: new Set<string>(),
    deny: new Set<string>(),
  };
  const unsupported: UnsupportedRule[] = [];

  for (const [source, list] of LISTS) {
    const groups: PolicyGroups = policy[source] ?? {};

    for (const name of CATEGORY_NAMES) {
      const category = CATEGORIES[name];
      const rules = (groups[name] ?? []) as readonly AnyRule[];

      rules.forEach((rule, index) => {
        const operations = rule.operations ?? ['*'];
        for (const result of category.translate(
          operations,
          category.targets(rule),
          source,
        )) {
          if (typeof result === 'string') lists[list].add(result);
          else
            unsupported.push({
              category: name,
              source,
              rule,
              reason: result.reason,
            });
        }

        const ignored = category.ignored(rule);
        if (ignored.length === 0) return;

        // Claude has no exceptions inside a rule: an allow rule's ignores
        // become denies, exact only while no other rule reaches them.
        if (source !== 'allow') {
          unsupported.push({
            category: name,
            source,
            rule,
            reason: `O Claude não tem exceções (ignores) em ${source}.`,
          });
          return;
        }

        // Per operation: another rule may reach the target for one
        // operation (read .git) and not for another (write .git).
        const expanded = operations.includes('*')
          ? category.operations
          : operations;

        for (const target of ignored) {
          const denied: string[] = [];

          for (const operation of expanded) {
            if (name === 'web' && operation === 'search') {
              unsupported.push({
                category: name,
                source,
                rule,
                reason: `${target} está em ignores, mas a busca do Claude não se limita a domínios.`,
              });
              continue;
            }
            // Another rule reaching it for this operation decides it in
            // Claude as in the policy (its allow, or its ask beating allow).
            if (
              !otherRuleReaching(policy, name, rule, index, target, operation)
            ) {
              denied.push(operation);
            }
          }

          if (denied.length === 0) continue;
          for (const result of category.translate(denied, [target], 'deny')) {
            if (typeof result === 'string') lists.deny.add(result);
            else
              unsupported.push({
                category: name,
                source,
                rule,
                reason: result.reason,
              });
          }
        }
      });
    }
  }

  return {
    native: {
      allow: [...lists.allow],
      ask: [...lists.ask],
      deny: [...lists.deny],
    },
    unsupported,
  };
}

/** Whether a rule other than `rule` (allow or requireApproval) reaches `target`. */
function otherRuleReaching(
  policy: AgentPolicy,
  name: PolicyCategory,
  rule: AnyRule,
  index: number,
  target: string,
  operation: string,
): boolean {
  const category = CATEGORIES[name];

  return (['allow', 'requireApproval'] as const).some((source) =>
    ((policy[source]?.[name] ?? []) as readonly AnyRule[]).some(
      (candidate, at) =>
        !(source === 'allow' && at === index && candidate === rule) &&
        covers(candidate.operations ?? ['*'], operation) &&
        category
          .targets(candidate)
          .some((pattern) => category.matches(target, pattern)),
    ),
  );
}

function covers(operations: readonly string[], operation: string): boolean {
  return operations.includes('*') || operations.includes(operation);
}

const unsupportedCategory =
  (reason: string): Category['translate'] =>
  () => [{ reason }];

const CATEGORIES: Readonly<Record<PolicyCategory, Category>> = {
  filesystem: {
    operations: ['read', 'write'],
    targets: (rule) => stringsOf(rule, 'paths'),
    ignored: (rule) => ignoredOf(rule, 'paths'),
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: (operations, paths) =>
      paths.flatMap((path) => [
        ...(covers(operations, 'read') ? [`Read(${claudePath(path)})`] : []),
        // Edit covers Claude's Write, Edit and NotebookEdit.
        ...(covers(operations, 'write') ? [`Edit(${claudePath(path)})`] : []),
      ]),
  },

  web: {
    operations: [
      'search',
      'read_text',
      'interact',
      'form_submit',
      'login',
      'browse',
    ],
    targets: (rule) => stringsOf(rule, 'domains'),
    ignored: (rule) => ignoredOf(rule, 'domains'),
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: (operations, domains, source) => {
      const results: (string | { reason: string })[] = [];

      if (covers(operations, 'read_text')) {
        for (const domain of domains) {
          results.push(
            domain === '*'
              ? 'WebFetch'
              : isClaudeDomain(domain)
                ? `WebFetch(domain:${domain})`
                : {
                    reason: `O Claude só aceita domínio exato, *.dominio ou *: ${domain}`,
                  },
          );
        }
      }

      if (covers(operations, 'search')) {
        // A search reaches any site: allowed only for every domain, denied
        // for any.
        if (source === 'deny' || domains.includes('*'))
          results.push('WebSearch');
        else
          results.push({
            reason: 'A busca do Claude não se limita a domínios.',
          });
      }

      // No Claude tool browses, fills forms or logs in: nothing to grant,
      // and nothing to deny.
      const browser = ['interact', 'form_submit', 'login', 'browse'].filter(
        (operation) => covers(operations, operation) && operations[0] !== '*',
      );
      if (source !== 'deny' && browser.length > 0) {
        results.push({
          reason: `O Claude não tem ferramenta para ${browser.join(', ')}.`,
        });
      }

      return results;
    },
  },

  network: {
    operations: ['connect'],
    targets: (rule) => stringsOf(rule, 'hosts'),
    ignored: () => [],
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: unsupportedCategory(
      'O Claude não controla a rede dos programas que roda.',
    ),
  },

  execution: {
    operations: ['*'],
    targets: (rule) => stringsOf(rule, 'commands'),
    ignored: (rule) => ignoredOf(rule, 'commands'),
    matches: (target, pattern) => commandMatches(target, pattern),
    // Claude's `*` matches anything, spaces included, as Goiaba's does.
    translate: (_operations, commands) =>
      commands.map((command) =>
        command.includes(')')
          ? { reason: `Um comando com ")" não cabe em Bash(...): ${command}` }
          : `Bash(${command})`,
      ),
  },

  tools: {
    operations: ['call'],
    targets: (rule) => stringsOf(rule, 'tools'),
    ignored: (rule) => ignoredOf(rule, 'tools'),
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: (_operations, tools) => tools.map(mcpRule),
  },

  agents: {
    operations: ['spawn'],
    targets: (rule) => stringsOf(rule, 'agents'),
    ignored: (rule) => ignoredOf(rule, 'agents'),
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: (_operations, agents) =>
      agents.map((agent) =>
        agent === '*'
          ? 'Agent'
          : /^[\w.-]+$/.test(agent)
            ? `Agent(${agent})`
            : {
                reason: `O Claude escolhe subagentes pelo nome exato, não por padrão nem por modelo: ${agent}`,
              },
      ),
  },

  communication: {
    operations: ['send_email', 'post_social_media', 'send_logs'],
    targets: (rule) => stringsOf(rule, 'channels'),
    ignored: () => [],
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: unsupportedCategory(
      'O Claude não tem como enviar comunicações.',
    ),
  },

  secrets: {
    operations: ['read'],
    targets: (rule) => stringsOf(rule, 'secrets'),
    ignored: () => [],
    matches: (target, pattern) => wildmatch(target, pattern),
    translate: unsupportedCategory(
      'O Claude não controla variáveis de ambiente nem credenciais.',
    ),
  },
};

function stringsOf(rule: AnyRule, key: string): readonly string[] {
  const value: unknown = Reflect.get(rule, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function ignoredOf(rule: AnyRule, key: string): readonly string[] {
  return rule.ignores?.[key] ?? [];
}

/**
 * Goiaba's `/workspace` is the folder Claude runs in: `./…`. Any other
 * absolute path is `//…` in Claude's rules.
 */
function claudePath(path: string): string {
  if (path === '/workspace') return '.';
  if (path.startsWith('/workspace/'))
    return `.${path.slice('/workspace'.length)}`;
  return path.startsWith('/') ? `/${path}` : path;
}

/** What Claude's WebFetch matches as the policy does: exact or `*.domain`. */
function isClaudeDomain(domain: string): boolean {
  const exact = domain.startsWith('*.') ? domain.slice(2) : domain;
  return exact.length > 0 && !/[*?[\]]/.test(exact);
}

/** `server/tool` as Claude's `mcp__server__tool` (`*` only as the whole tool). */
function mcpRule(tool: string): string | { reason: string } {
  const invalid = {
    reason: `O Claude só aceita servidor/ferramenta, servidor/* ou servidor: ${tool}`,
  };
  const parts = tool.split('/');
  const [server = '', name = ''] = parts;

  if (parts.length > 2 || !/^[\w-]+$/.test(server)) return invalid;
  if (parts.length === 1) return `mcp__${server}`;
  if (name === '*') return `mcp__${server}__*`;
  return /^[\w.-]+$/.test(name) ? `mcp__${server}__${name}` : invalid;
}
