import { HOOK_TIMEOUT_SECONDS } from '../../approval/constants';
import { UsageError } from '../../errors';
import { commandMatches } from '../../policy/command';
import { delegatedCategories } from '../../policy/index';
import type {
  AgentPolicy,
  ExecutionRule,
  PolicyCategory,
  PolicyGroups,
  PolicyRule,
  WebRule,
} from '../../policy/policy.interface';
import { wildmatch } from '../../policy/wildmatch';
import type { PolicyTranslation, UnsupportedRule } from '../provider.interface';

/** An `AgentPolicy` in Codex's own language. */
export interface CodexPermissions {
  /** `-c key=value` overrides: keys of `config.toml`, values in TOML. */
  readonly config: Readonly<Record<string, string>>;
  /** A `rules/*.rules` file: one `prefix_rule(...)` per command. */
  readonly rules: string;
}

type Source = UnsupportedRule['source'];

const SOURCES: readonly Source[] = ['allow', 'requireApproval', 'deny'];

/** Command rule decisions, from the policy's lists. */
const DECISIONS: Readonly<Record<Source, string>> = {
  allow: 'allow',
  requireApproval: 'prompt',
  deny: 'forbidden',
};

class Translation {
  public readonly config: Record<string, string> = {};
  public readonly rules: string[] = [];
  public readonly unsupported: UnsupportedRule[] = [];

  public constructor(public readonly policy: AgentPolicy) {}

  public skip(
    category: PolicyCategory,
    source: Source,
    rule: PolicyRule,
    reason: string,
    // Not granting what allow asks is stricter; not enforcing a denial or an
    // ignore is looser.
    effect: UnsupportedRule['effect'] = source === 'allow'
      ? 'stricter'
      : 'looser',
  ): void {
    this.unsupported.push({ category, source, rule, reason, effect });
  }

  public rulesOf<K extends PolicyCategory>(
    source: Source,
    category: K,
  ): NonNullable<PolicyGroups[K]> | readonly [] {
    return this.policy[source]?.[category] ?? [];
  }
}

/**
 * An `AgentPolicy` as Codex expresses it: sandbox and tool settings for
 * `config.toml` (`-c`) and command rules for a `.rules` file. Pure: nothing
 * is written. What Codex cannot express exactly goes to `unsupported`.
 */
export function translateCodexPolicy(
  policy: AgentPolicy,
): PolicyTranslation<CodexPermissions> {
  const translation = new Translation(policy);

  filesystem(translation);
  web(translation);
  network(translation);
  execution(translation);
  tools(translation);
  secrets(translation);
  notExpressible(
    translation,
    'agents',
    'O Codex não escolhe subagentes por regra.',
  );
  notExpressible(
    translation,
    'communication',
    'O Codex não tem como enviar comunicações.',
  );

  return {
    native: {
      config: translation.config,
      // The same rule from two sources (ignores and deny) once.
      rules: [...new Set(translation.rules)].join('\n'),
    },
    unsupported: translation.unsupported,
  };
}

/** Codex's sandbox splits reading from writing, nothing finer. */
function filesystem(t: Translation): void {
  let workspaceWrite = false;
  const writableRoots: string[] = [];

  for (const rule of t.rulesOf('allow', 'filesystem')) {
    if ((rule.ignores?.paths?.length ?? 0) > 0) {
      t.skip(
        'filesystem',
        'allow',
        rule,
        'O Codex não tem exceções de caminho (ignores).',
        'looser',
      );
    }
    if (!covers(rule.operations, 'write')) continue;

    for (const path of rule.paths) {
      if (path === '/workspace' || path === '/workspace/**') {
        workspaceWrite = true;
      } else if (path.startsWith('/workspace/')) {
        t.skip(
          'filesystem',
          'allow',
          rule,
          `O Codex só libera escrita na pasta inteira do projeto, não em ${path}.`,
        );
      } else if (/^\/[^*?[\]]*\/\*\*$/.test(path)) {
        writableRoots.push(path.slice(0, -'/**'.length));
      } else {
        t.skip(
          'filesystem',
          'allow',
          rule,
          `O Codex só libera escrita em pastas inteiras: ${path}`,
        );
      }
    }
  }

  const firstAllow = t.rulesOf('allow', 'filesystem').at(0);
  if (firstAllow !== undefined) {
    t.skip(
      'filesystem',
      'allow',
      firstAllow,
      'O Codex lê qualquer caminho do disco: só a escrita fica limitada.',
      'looser',
    );
  }
  for (const rule of t.rulesOf('requireApproval', 'filesystem')) {
    t.skip(
      'filesystem',
      'requireApproval',
      rule,
      'O Codex não pergunta antes de ler ou escrever arquivos.',
    );
  }
  for (const rule of t.rulesOf('deny', 'filesystem')) {
    t.skip(
      'filesystem',
      'deny',
      rule,
      'O Codex não bloqueia nem esconde caminhos.',
    );
  }

  if (writableRoots.length > 0 && !workspaceWrite) {
    t.skip(
      'filesystem',
      'allow',
      t.rulesOf('allow', 'filesystem')[0] ?? {
        operations: [],
        paths: [],
      },
      'Para gravar fora do projeto, o Codex também libera a escrita no projeto.',
      'looser',
    );
  }

  const writable = workspaceWrite || writableRoots.length > 0;
  t.config['sandbox_mode'] = writable ? '"workspace-write"' : '"read-only"';
  if (writableRoots.length > 0) {
    t.config['sandbox_workspace_write.writable_roots'] = toml(writableRoots);
  }
}

/** One web search tool, which also opens pages: `search` and `read_text`. */
function web(t: Translation): void {
  const allowed = new Set<string>();
  const blocked = new Set<string>();
  let anyDomain = false;
  let enabled = false;

  for (const rule of t.rulesOf('allow', 'web')) {
    browserOperations(t, 'allow', rule);
    if (!webTool(rule)) continue;
    enabled = true;

    for (const domain of rule.domains) {
      if (domain === '*') anyDomain = true;
      else {
        const codex = codexDomain(domain);
        if (codex === undefined) {
          t.skip(
            'web',
            'allow',
            rule,
            `O Codex só aceita domínio, *.dominio ou *: ${domain}`,
          );
          continue;
        }
        allowed.add(codex);
        // A Codex domain also opens its subdomains (and `*.x` opens x too):
        // more than the policy allows, so it is said, never silent.
        t.skip(
          'web',
          'allow',
          rule,
          `O Codex libera ${codex} junto com os subdomínios: ${domain}`,
          'looser',
        );
      }
    }

    for (const domain of rule.ignores?.domains ?? []) {
      const codex = codexDomain(domain);
      if (codex === undefined || otherWebRuleReaching(t, rule, domain)) {
        t.skip(
          'web',
          'allow',
          rule,
          `${domain} está em ignores, mas não dá para bloqueá-lo sem afetar outra regra.`,
          'looser',
        );
      } else blocked.add(codex);
    }
  }

  for (const rule of t.rulesOf('requireApproval', 'web')) {
    t.skip(
      'web',
      'requireApproval',
      rule,
      'O Codex aplica busca web sem requireApproval; não pergunta antes de buscar.',
    );
  }

  let disabled = !enabled;
  for (const rule of t.rulesOf('deny', 'web')) {
    if ((rule.ignores?.domains?.length ?? 0) > 0) {
      t.skip(
        'web',
        'deny',
        rule,
        'O Codex não tem exceções (ignores) em deny.',
        'stricter',
      );
    }
    if (!webTool(rule)) continue;
    for (const domain of rule.domains) {
      if (domain === '*') disabled = true;
      else {
        const codex = codexDomain(domain);
        if (codex === undefined) {
          t.skip(
            'web',
            'deny',
            rule,
            `O Codex só aceita domínio, *.dominio ou *: ${domain}`,
          );
        } else blocked.add(codex);
      }
    }
  }

  if (disabled) {
    t.config['tools.web_search'] = '{mode="disabled"}';
    return;
  }

  const fields = ['mode="live"'];
  if (!anyDomain) fields.push(`allowed_domains=${toml([...allowed])}`);
  if (blocked.size > 0) fields.push(`blocked_domains=${toml([...blocked])}`);
  t.config['tools.web_search'] = `{${fields.join(',')}}`;
}

/** Only on or off for the whole network. */
function network(t: Translation): void {
  let allowAll = false;
  let denyAll = false;

  for (const rule of t.rulesOf('allow', 'network')) {
    if (rule.hosts.includes('*') && (rule.ignores?.hosts?.length ?? 0) === 0) {
      allowAll = true;
    } else {
      t.skip(
        'network',
        'allow',
        rule,
        'O Codex só liga ou desliga a rede inteira (hosts: ["*"]).',
      );
    }
  }
  for (const rule of t.rulesOf('requireApproval', 'network')) {
    t.skip(
      'network',
      'requireApproval',
      rule,
      'O Codex não pergunta antes de acessar a rede.',
    );
  }
  for (const rule of t.rulesOf('deny', 'network')) {
    if (rule.hosts.includes('*')) denyAll = true;
    else {
      t.skip(
        'network',
        'deny',
        rule,
        'O Codex só liga ou desliga a rede inteira (hosts: ["*"]).',
      );
    }
  }

  t.config['sandbox_workspace_write.network_access'] = String(
    allowAll && !denyAll,
  );
}

/**
 * `prefix_rule`s compare the start of a command: `npm *` is exact, but an
 * exact `pwd` would also let `pwd -P` through, so only denying it is safe.
 */
function execution(t: Translation): void {
  for (const source of SOURCES) {
    t.rulesOf(source, 'execution').forEach((rule, index) => {
      for (const command of rule.commands) {
        addPrefixRule(t, source, rule, command, DECISIONS[source]);
      }

      const ignored = rule.ignores?.commands ?? [];
      if (ignored.length === 0) return;
      if (source !== 'allow') {
        t.skip(
          'execution',
          source,
          rule,
          `O Codex não tem exceções (ignores) em ${source}.`,
          'stricter',
        );
        return;
      }
      for (const command of ignored) {
        const reached = SOURCES.slice(0, 2).some((other) =>
          t
            .rulesOf(other, 'execution')
            .some(
              (candidate, at) =>
                !(other === 'allow' && at === index) &&
                candidate.commands.some((pattern) =>
                  commandMatches(command, pattern),
                ),
            ),
        );
        if (reached) {
          t.skip(
            'execution',
            source,
            rule,
            `${command} está em ignores, mas outra regra o alcança.`,
            'looser',
          );
        } else addPrefixRule(t, 'deny', rule, command, DECISIONS.deny);
      }
    });
  }
}

function addPrefixRule(
  t: Translation,
  source: Source,
  rule: ExecutionRule,
  command: string,
  decision: string,
): void {
  const tokens = command.trim().split(/\s+/);
  const prefix = tokens.at(-1) === '*' ? tokens.slice(0, -1) : tokens;
  const exact = tokens.at(-1) === '*';

  if (
    prefix.length === 0 ||
    prefix.some((token) => /[*|&;<>()$`]/.test(token))
  ) {
    t.skip(
      'execution',
      source,
      rule,
      `O Codex só aceita comandos com * no fim: ${command}`,
    );
    return;
  }
  if (!exact && source === 'allow') {
    t.skip(
      'execution',
      source,
      rule,
      `O Codex compara pelo começo: liberar "${command}" liberaria também "${command} …".`,
    );
    return;
  }

  t.rules.push(
    `prefix_rule(pattern=${JSON.stringify(prefix)}, decision="${decision}")`,
  );
}

/** MCP servers: tools enabled or disabled per server. */
function tools(t: Translation): void {
  const enabled = new Map<string, Set<string>>();
  const whole = new Set<string>();
  const disabled = new Map<string, Set<string>>();
  const off = new Set<string>();

  for (const source of SOURCES) {
    for (const rule of t.rulesOf(source, 'tools')) {
      if (source === 'requireApproval') {
        t.skip(
          'tools',
          source,
          rule,
          'O Codex não pergunta antes de usar uma ferramenta MCP.',
        );
        continue;
      }
      if (source === 'deny' && (rule.ignores?.tools?.length ?? 0) > 0) {
        t.skip(
          'tools',
          source,
          rule,
          'O Codex não tem exceções (ignores) em deny.',
          'stricter',
        );
      }

      const targets = [
        ...rule.tools.map((tool) => [tool, source] as const),
        ...(source === 'allow'
          ? (rule.ignores?.tools ?? []).map((tool) => [tool, 'deny'] as const)
          : []),
      ];

      for (const [tool, effect] of targets) {
        const parsed = mcpTool(tool);
        if (parsed === undefined) {
          t.skip(
            'tools',
            source,
            rule,
            `O Codex só aceita servidor/ferramenta, servidor/* ou servidor: ${tool}`,
          );
          continue;
        }
        const [server, name] = parsed;
        if (effect === 'allow') {
          if (name === undefined) whole.add(server);
          else add(enabled, server, name);
        } else if (name === undefined) off.add(server);
        else add(disabled, server, name);
      }
    }
  }

  for (const [server, names] of enabled) {
    if (!whole.has(server)) {
      t.config[`mcp_servers.${server}.enabled_tools`] = toml([...names]);
    }
  }
  for (const [server, names] of disabled) {
    t.config[`mcp_servers.${server}.disabled_tools`] = toml([...names]);
  }
  for (const server of off) t.config[`mcp_servers.${server}.enabled`] = 'false';
}

/** Environment variables the commands Codex runs receive. */
function secrets(t: Translation): void {
  const include = new Set<string>();
  const exclude = new Set<string>();
  let all = false;

  for (const rule of t.rulesOf('allow', 'secrets')) {
    for (const name of rule.secrets) {
      if (name === '*') all = true;
      else include.add(name);
    }
    for (const name of rule.ignores?.secrets ?? []) exclude.add(name);
  }
  for (const rule of t.rulesOf('requireApproval', 'secrets')) {
    t.skip(
      'secrets',
      'requireApproval',
      rule,
      'O Codex não pergunta antes de passar uma variável.',
    );
  }
  for (const rule of t.rulesOf('deny', 'secrets')) {
    if ((rule.ignores?.secrets?.length ?? 0) > 0) {
      t.skip(
        'secrets',
        'deny',
        rule,
        'O Codex não tem exceções (ignores) em deny.',
        'stricter',
      );
    }
    for (const name of rule.secrets) exclude.add(name);
  }

  const any =
    t.rulesOf('allow', 'secrets').length > 0 ||
    t.rulesOf('deny', 'secrets').length > 0;
  if (!any) return;

  // Default deny: only what is allowed reaches the commands.
  if (!all)
    t.config['shell_environment_policy.include_only'] = toml([...include]);
  if (exclude.size > 0) {
    t.config['shell_environment_policy.exclude'] = toml([...exclude]);
  }
}

function notExpressible(
  t: Translation,
  category: PolicyCategory,
  reason: string,
): void {
  for (const source of SOURCES) {
    // Codex does not control it at all: everything is allowed there.
    for (const rule of t.rulesOf(source, category))
      t.skip(category, source, rule, reason, 'looser');
  }
}

function covers(operations: readonly string[], operation: string): boolean {
  return operations.includes('*') || operations.includes(operation);
}

function webTool(rule: WebRule): boolean {
  return (
    covers(rule.operations, 'search') || covers(rule.operations, 'read_text')
  );
}

/** No Codex tool browses, fills forms or logs in: nothing to grant. */
function browserOperations(
  t: Translation,
  source: Source,
  rule: WebRule,
): void {
  const browser = (
    ['interact', 'form_submit', 'login', 'browse'] as const
  ).filter((operation) => rule.operations.includes(operation));
  if (browser.length > 0) {
    t.skip(
      'web',
      source,
      rule,
      `O Codex não tem ferramenta para ${browser.join(', ')}.`,
    );
  }
}

function otherWebRuleReaching(
  t: Translation,
  rule: WebRule,
  domain: string,
): boolean {
  return t
    .rulesOf('allow', 'web')
    .some(
      (candidate) =>
        candidate !== rule &&
        webTool(candidate) &&
        candidate.domains.some((pattern) => wildmatch(domain, pattern)),
    );
}

/** `x` or `*.x` as Codex's `x` (which covers its subdomains). */
function codexDomain(domain: string): string | undefined {
  const plain = domain.startsWith('*.') ? domain.slice(2) : domain;
  return plain.length === 0 || /[*?[\]]/.test(plain) ? undefined : plain;
}

/** `server/tool` → [server, tool]; `server` or `server/*` → [server]. */
function mcpTool(
  tool: string,
): readonly [string, string | undefined] | undefined {
  const parts = tool.split('/');
  const [server = '', name = ''] = parts;
  if (parts.length > 2 || !/^[\w-]+$/.test(server)) return undefined;
  if (parts.length === 1 || name === '*') return [server, undefined];
  return /^[\w.-]+$/.test(name) ? [server, name] : undefined;
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function toml(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(',')}]`;
}

/**
 * The translation the provider applies: refuses a category Codex does not
 * apply yet (only execution and web are delegated to it), and a web rule it
 * would apply more loosely than the policy.
 */
export function applicableCodexPolicy(
  policy: AgentPolicy,
): PolicyTranslation<CodexPermissions> {
  const unsupported = delegatedCategories(policy).find(
    (category) => category !== 'execution' && category !== 'web',
  );
  if (unsupported !== undefined) {
    throw new UsageError(
      `O provider codex ainda não aplica a categoria ${unsupported}.`,
    );
  }

  const translated = translateCodexPolicy(policy);
  const looser = translated.unsupported.find(
    (rule) => rule.category === 'web' && rule.effect === 'looser',
  );
  if (looser !== undefined) {
    throw new UsageError(
      `O provider codex não aplica esta regra web: ${looser.reason}`,
    );
  }
  return translated;
}

/** Codex's `hooks.json`, in its own words: the gate decides each Bash call. */
export function codexHooks(hookCommand: readonly string[]): {
  readonly hooks: {
    readonly PreToolUse: readonly {
      readonly matcher: string;
      readonly hooks: readonly {
        readonly type: 'command';
        readonly command: string;
        readonly timeout: number;
      }[];
    }[];
  };
} {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: '^Bash$',
          hooks: [
            {
              type: 'command',
              command: shellJoin(hookCommand),
              timeout: HOOK_TIMEOUT_SECONDS,
            },
          ],
        },
      ],
    },
  };
}

/** POSIX shell quoting for the hook command line. */
function shellJoin(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}
