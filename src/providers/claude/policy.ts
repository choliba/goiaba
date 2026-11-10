import { HOOK_TIMEOUT_SECONDS } from '../../approval/constants';
import { TOOL_SERVER } from '../../tools/constants';
import type { ToolServer } from '../../tools/broker';
import { UsageError } from '../../errors';
import { commandMatches } from '../../policy/command';
import { delegatedCategories } from '../../policy/index';
import type {
  AgentPolicy,
  PolicyCategory,
  PolicyGroups,
} from '../../policy/policy.interface';
import { wildmatch } from '../../policy/wildmatch';
import type { PolicyTranslation, UnsupportedRule } from '../provider.interface';
import type { ExecutionGate } from '../types';

/** Claude Code's own permission lists (`permissions` in its settings). */
export interface ClaudePermissions {
  readonly allow: readonly string[];
  readonly ask: readonly string[];
  readonly deny: readonly string[];
}

/**
 * The settings Claude Code runs with (`--settings`), in its own words: the
 * keys are Claude's (`permissions`, `hooks`, `PreToolUse`), never Goiaba's.
 */
export interface ClaudeSettings {
  readonly permissions: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  readonly hooks?: {
    readonly PreToolUse: readonly {
      readonly matcher: string;
      readonly hooks: readonly {
        readonly type: 'command';
        readonly command: string;
        readonly timeout: number;
        readonly onFailure: 'block';
      }[];
    }[];
  };
}

// Tools that touch files; the sandbox decides which paths they reach.
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit'];

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
  ) => readonly (string | Unexpressed)[];
}

type Effect = UnsupportedRule['effect'];

/** A rule Claude cannot express, and what happens instead (by default, by source). */
interface Unexpressed {
  readonly reason: string;
  readonly effect?: Effect;
}

/** Not granting what allow asks is stricter; not enforcing a denial is looser. */
function defaultEffect(source: Source): Effect {
  return source === 'allow' ? 'stricter' : 'looser';
}

/**
 * An `AgentPolicy` in Claude Code's language: `allow`, `ask`
 * (requireApproval) and `deny` lists of rules such as `Read(./src/**)`,
 * `Bash(npm *)`, `WebFetch(domain:bun.sh)`, `mcp__github__*`,
 * `Agent(revisor)`. Pure: nothing is written. What Claude cannot express
 * exactly goes to `unsupported`.
 */
export function translateClaudePolicy(
  policy: AgentPolicy,
): PolicyTranslation<ClaudePermissions> {
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
        const ignored = category.ignored(rule);
        let results = category.translate(
          operations,
          category.targets(rule),
          source,
        );

        // A search cannot leave the ignored domains out: off for this rule.
        if (
          name === 'web' &&
          source === 'allow' &&
          ignored.length > 0 &&
          results.includes('WebSearch')
        ) {
          results = results.filter((result) => result !== 'WebSearch');
          unsupported.push({
            category: name,
            source,
            rule,
            reason:
              'A busca do Claude não exclui domínios (ignores): fica desligada nessa regra.',
            effect: 'stricter',
          });
        }

        for (const result of results) {
          if (typeof result === 'string') lists[list].add(result);
          else
            unsupported.push({
              category: name,
              source,
              rule,
              reason: result.reason,
              effect: result.effect ?? defaultEffect(source),
            });
        }

        if (ignored.length === 0) return;

        // Claude has no exceptions inside a rule: an allow rule's ignores
        // become denies, exact only while no other rule reaches them.
        if (source !== 'allow') {
          unsupported.push({
            category: name,
            source,
            rule,
            reason: `O Claude não tem exceções (ignores) em ${source}.`,
            // The rule covers the ignored targets too.
            effect: 'stricter',
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
            // The search is off for this rule already (above).
            if (name === 'web' && operation === 'search') continue;
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
                // The ignored target stays allowed by this rule.
                effect: 'looser',
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

/** Claude does not control it at all: everything is allowed there. */
const unsupportedCategory =
  (reason: string): Category['translate'] =>
  () => [{ reason, effect: 'looser' }];

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

/**
 * The settings Claude Code needs to apply what the sandbox cannot: the web
 * rules and, with a `gate`, the PreToolUse hook that decides each Bash call.
 * `undefined` when there is nothing for Claude to apply (the sandbox is the
 * limit). Throws a `UsageError` for a category Claude does not apply yet, or a
 * web rule it would apply more loosely than the policy.
 */
export function claudeSettings(
  policy: AgentPolicy,
  gate: ExecutionGate | undefined,
  ownTools = false,
): ClaudeSettings | undefined {
  const categories = delegatedCategories(policy);
  const unsupported = categories.find(
    (category) => category !== 'execution' && category !== 'web',
  );

  if (unsupported !== undefined) {
    throw new UsageError(
      `O provider claude ainda não aplica a categoria ${unsupported}.`,
    );
  }

  if (gate === undefined && !categories.includes('web')) return undefined;

  const web = webSettings(translateClaudePolicy(policy));

  // dontAsk runs only what is pre-approved: file tools (the sandbox limits
  // their paths), the web tools the rules allow and Bash calls the gate's
  // hook allows. Without execution rules the sandbox is Bash's limit.
  return {
    permissions: {
      allow: [
        ...FILE_TOOLS,
        ...(gate === undefined ? ['Bash'] : []),
        ...web.allow,
        // The agent's own tools: the Goiaba's server lists only what the
        // policy allows and checks each call, so all of them may run here.
        ...(ownTools ? [`mcp__${TOOL_SERVER}`] : []),
      ],
      deny: web.deny,
    },
    ...(gate === undefined
      ? {}
      : {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  {
                    type: 'command',
                    command: shellJoin(gate.hookCommand),
                    timeout: HOOK_TIMEOUT_SECONDS,
                    // A hook that times out must block, not let the call
                    // through.
                    onFailure: 'block',
                  },
                ],
              },
            ],
          },
        }),
  };
}

/**
 * The web part of the translation, as the settings the CLI runs with. Refuses
 * what Claude would apply more loosely than the policy, and requireApproval:
 * with `--print` nobody answers an `ask`.
 */
function webSettings(translated: PolicyTranslation<ClaudePermissions>): {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
} {
  const looser = translated.unsupported.find(
    (rule) => rule.category === 'web' && rule.effect === 'looser',
  );
  if (looser !== undefined) {
    throw new UsageError(
      `O provider claude não aplica esta regra web: ${looser.reason}`,
    );
  }
  if (translated.native.ask.some(isWebRule)) {
    throw new UsageError(
      'O provider claude ainda não aplica requireApproval em web.',
    );
  }

  return {
    allow: translated.native.allow.filter(isWebRule),
    deny: translated.native.deny.filter(isWebRule),
  };
}

function isWebRule(rule: string): boolean {
  return rule.startsWith('WebFetch') || rule.startsWith('WebSearch');
}

/** POSIX shell quoting for the hook command line. */
function shellJoin(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

/**
 * The MCP config Claude Code reads (`--mcp-config`), in its own words: the
 * agent's own tools' server, started by the CLI inside the sandbox.
 */
export function claudeMcpConfig(server: ToolServer): {
  readonly mcpServers: Readonly<
    Record<
      string,
      { readonly command: string; readonly args: readonly string[] }
    >
  >;
} {
  const [command = '', ...args] = server.command;
  return { mcpServers: { [server.name]: { command, args } } };
}
