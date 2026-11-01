/**
 * Network rules, and everything about what they mean: their shape, which
 * one wins, which destination a host pattern covers, which are invalid, and
 * which `localhost` ones reach the host. Nothing else of the policy comes
 * here: the network gets only its own rules (see `NetworkRules`).
 */

import { UsageError } from '../errors';
import { validateWildmatch, wildmatch } from '../policy/wildmatch';

/** Any process reaching the network (curl, npm install, git push), not only web tools. */
export type NetworkOperation = 'connect';

export interface NetworkRule {
  readonly operations: readonly (NetworkOperation | '*')[];
  /** `registry.npmjs.org`, `*.github.com`, `example.com:443`. */
  readonly hosts: readonly string[];
  readonly ignores?: { readonly hosts?: readonly string[] };
}

export type NetworkPolicy = 'allow' | 'deny' | 'require_approval';

/** The network rules of a policy: its `network` lists and its `default`. */
export interface NetworkRules {
  /** What a destination no rule matches gets. */
  readonly default: NetworkPolicy;
  readonly allow?: readonly NetworkRule[];
  readonly requireApproval?: readonly NetworkRule[];
  readonly deny?: readonly NetworkRule[];
}

/**
 * The part of a policy the network reads: the `network` list of each group
 * and the `default`. Any `AgentPolicy` has this shape; the network needs
 * nothing else of it.
 */
export interface PolicyNetworkPart {
  readonly default: NetworkPolicy;
  readonly allow?: { readonly network?: readonly NetworkRule[] };
  readonly requireApproval?: { readonly network?: readonly NetworkRule[] };
  readonly deny?: { readonly network?: readonly NetworkRule[] };
}

/**
 * How a policy becomes the network's rules: each group keeps only its
 * `network` list, and the `default` comes along for what no rule covers.
 *
 *   { default: 'deny',                         { default: 'deny',
 *     allow: { filesystem: […],          →       allow: [{ hosts: ['github.com'] }],
 *              network: [{ hosts: ['github.com'] }] },
 *     deny:  { network: [{ hosts: ['169.254.169.254'] }] } }
 *                                                deny: [{ hosts: ['169.254.169.254'] }] }
 *
 * With no `network` list at all, only the `default` decides (`deny` shuts
 * the network but for the provider's endpoints).
 */
export function networkRulesOf(policy: PolicyNetworkPart): NetworkRules {
  return {
    default: policy.default,
    allow: policy.allow?.network ?? [],
    requireApproval: policy.requireApproval?.network ?? [],
    deny: policy.deny?.network ?? [],
  };
}

export type NetworkRuleSource =
  'allow' | 'requireApproval' | 'deny' | 'default';

export interface NetworkRuleDecision {
  readonly policy: NetworkPolicy;
  readonly source: NetworkRuleSource;
  readonly reason: string;
}

/** The strictest wins: `deny`, then `requireApproval`, then `allow`. */
const BY_STRICTNESS = [
  ['deny', 'deny'],
  ['requireApproval', 'require_approval'],
  ['allow', 'allow'],
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** What the rules decide for `destination` (`host:port`). */
export function decideByRules(
  rules: NetworkRules,
  destination: string,
): NetworkRuleDecision {
  for (const [source, policy] of BY_STRICTNESS) {
    if ((rules[source] ?? []).some((rule) => covers(rule, destination))) {
      return {
        policy,
        source,
        reason: `A ação corresponde a permissions.${source}.network.`,
      };
    }
  }

  return {
    policy: rules.default,
    source: 'default',
    reason: 'Nenhuma regra corresponde à ação.',
  };
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

/**
 * Refuses rules that would silently do nothing: no operations, no hosts, a
 * URL or a path instead of a host, a broken pattern.
 */
export function validateNetworkRules(rules: NetworkRules): void {
  if (!['allow', 'deny', 'require_approval'].includes(rules.default)) {
    throw new UsageError(
      `Política padrão inválida: ${rules.default as string}`,
    );
  }

  for (const [source] of BY_STRICTNESS) {
    for (const rule of rules[source] ?? []) {
      if (rule.operations.length === 0) {
        throw new UsageError('Uma regra network precisa ter operações.');
      }
      if (rule.hosts.length === 0) {
        throw new UsageError('Uma regra network precisa ter alvos.');
      }

      for (const host of [...rule.hosts, ...(rule.ignores?.hosts ?? [])]) {
        if (host.includes('/')) {
          throw new UsageError(
            `Host inválido em ${source}.network: ${host}. Use só o host, com porta opcional (ex.: duckduckgo.com ou duckduckgo.com:443).`,
          );
        }
        validateWildmatch(host);
      }
    }
  }
}

/**
 * `localhost:<port>` (or `127.0.0.1:<port>`) that a rule may let through:
 * inside the sandbox, `localhost` is the sandbox itself, so these get a
 * tunnel to the host's port (a dev server you run there). Only exact ports:
 * `localhost:*` cannot open every port.
 */
export function localPorts(rules: NetworkRules): string[] {
  return [...(rules.allow ?? []), ...(rules.requireApproval ?? [])]
    .flatMap((rule) => rule.hosts)
    .filter((host) => {
      const { host: name, port } = splitHost(host);
      return (
        LOCAL_HOSTS.has(name.replace(/^\[(.*)\]$/, '$1')) &&
        port !== undefined &&
        /^\d+$/.test(port)
      );
    });
}

function covers(rule: NetworkRule, destination: string): boolean {
  return (
    (rule.operations.includes('*') || rule.operations.includes('connect')) &&
    rule.hosts.some((pattern) => hostMatches(destination, pattern)) &&
    !(rule.ignores?.hosts ?? []).some((pattern) =>
      hostMatches(destination, pattern),
    )
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
