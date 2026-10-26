import { reportDebug, reportError } from '../output/activity';
import { commandMatches, parseCommand } from '../policy/command';
import { PolicyEngine, type AgentPolicy } from '../policy/index';
import type { ApprovalScope, Store } from '../store/index';

export interface CommandApprovalRequest {
  readonly command: string;
  /** Why the policy did not decide on its own. */
  readonly reason: string;
  /** Pattern a `session`/`workspace` approval would save. */
  readonly pattern: string;
  readonly provider: string;
}

/** Decides what the policy leaves open; a person, by default. */
export type CommandApprover = (
  request: CommandApprovalRequest,
) => Promise<ApprovalScope>;

export interface CommandDecision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

export interface CommandGateOptions {
  readonly permissions: AgentPolicy;
  readonly provider: string;
  readonly root: string;
  readonly approve: CommandApprover;
  readonly store?: Store;
}

/**
 * `policy`: a rule decided (an explicit deny is final). `default`: no rule
 * matched and the default denied (an approval can change that).
 */
export type DecisionSource = 'policy' | 'default' | 'human' | 'saved';

/** A decision on a command, as the gate made it. */
export interface CommandDecisionEvent {
  readonly command: string;
  readonly decision: 'allow' | 'deny';
  readonly source: DecisionSource;
  readonly reason: string;
}

/**
 * Decides whether a shell command may run: the policy first, then approvals
 * already given, then the approver. Every decision is recorded.
 */
export class CommandGate {
  private readonly policy: PolicyEngine;
  private readonly approvals: SavedApprovals;
  /** Approvals are asked one at a time, never interleaved. */
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: CommandGateOptions) {
    this.policy = new PolicyEngine(options.permissions);
    this.approvals = new SavedApprovals(options.root, options.store);
  }

  public setSession(id: string): void {
    this.approvals.setSession(id);
  }

  public async decide(command: string): Promise<CommandDecision> {
    const decision = this.policy.checkCommand(command);

    if (decision.policy === 'allow') {
      return this.record(command, 'allow', 'policy', decision.reason);
    }

    // An explicit `deny` rule always wins, even over approvals.
    if (decision.source === 'deny') {
      return this.record(command, 'deny', 'policy', decision.reason);
    }

    // requireApproval, or the `default` deny: what was approved since counts.
    const saved = this.approvals.cover(command, this.policy);

    if (saved !== undefined) {
      return this.record(command, 'allow', 'saved', saved);
    }

    if (decision.policy === 'deny') {
      return this.record(command, 'deny', 'default', decision.reason, {
        // What the agent reads: a person decides, so retrying only repeats it.
        toAgent: (id) => awaitingApproval(id),
      });
    }

    return this.ask(command, decision.reason);
  }

  private ask(command: string, reason: string): Promise<CommandDecision> {
    const ask = (): Promise<CommandDecision> =>
      this.askApprover(command, reason);
    const result = this.queue.then(ask, ask);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async askApprover(
    command: string,
    reason: string,
  ): Promise<CommandDecision> {
    const pattern = suggestPattern(command);
    const scope = await this.options
      .approve({ command, reason, pattern, provider: this.options.provider })
      .catch((): ApprovalScope => 'deny');

    if (scope === 'deny') {
      return this.record(command, 'deny', 'human', 'Negado pelo usuário.', {
        scope,
      });
    }

    this.approvals.remember(scope, pattern);
    return this.record(command, 'allow', 'human', 'Aprovado pelo usuário.', {
      scope,
    });
  }

  private record(
    command: string,
    decision: 'allow' | 'deny',
    source: DecisionSource,
    reason: string,
    {
      scope,
      toAgent,
    }: {
      readonly scope?: ApprovalScope;
      /** The reason the agent gets, from the request's id, when it differs. */
      readonly toAgent?: (id: number | undefined) => string;
    } = {},
  ): CommandDecision {
    const id = this.options.store?.recordDecision({
      session: this.approvals.session(),
      provider: this.options.provider,
      root: this.options.root,
      command,
      decision,
      source,
      ...(scope === undefined ? {} : { scope }),
      reason,
    });
    reportDecision({ command, decision, source, reason });
    return { decision, reason: toAgent?.(id) ?? reason };
  }
}

/** Approvals given before: this session's patterns and the store's. */
class SavedApprovals {
  private readonly sessionPatterns: string[] = [];
  private currentSession: string | undefined;

  public constructor(
    private readonly root: string,
    private readonly store: Store | undefined,
  ) {}

  public setSession(id: string): void {
    this.currentSession = id;
  }

  public session(): string | undefined {
    return this.currentSession;
  }

  public remember(scope: ApprovalScope, pattern: string): void {
    if (scope === 'session') this.sessionPatterns.push(pattern);
    if (scope === 'workspace') {
      // Given at the prompt: the agent already got the command through.
      this.store?.saveApproval({
        root: this.root,
        pattern,
        kind: 'workspace',
        notified: true,
      });
    }
  }

  /**
   * A saved approval covers a line only if every part is allowed by the
   * policy or matches an approved pattern. A line with redirection or
   * substitution is only covered by an exact one-time approval.
   */
  public cover(command: string, policy: PolicyEngine): string | undefined {
    if (this.consumeOnce(command)) return 'Aprovado uma vez.';
    // An exact approval covers even a complex line (a heredoc, a redirect).
    if (this.patterns().includes(command.trim())) {
      return 'Aprovado para este workspace.';
    }

    const { parts, complex } = parseCommand(command);
    if (complex) return undefined;

    const patterns = this.patterns();
    const covered = parts.every(
      (part) =>
        isAllowed(policy, part) ||
        patterns.some((pattern) => commandMatches(part, pattern)),
    );

    return covered ? 'Coberto por uma aprovação salva.' : undefined;
  }

  private consumeOnce(command: string): boolean {
    const once = this.active().find(
      (approval) =>
        approval.kind === 'once' && approval.pattern === command.trim(),
    );

    if (once === undefined) return false;

    this.store?.consumeApproval(once.id);
    return true;
  }

  private patterns(): string[] {
    const workspace = this.active()
      .filter((approval) => approval.kind === 'workspace')
      .map((approval) => approval.pattern);
    return [...this.sessionPatterns, ...workspace];
  }

  private active(): ReturnType<Store['activeApprovals']> {
    return this.store?.activeApprovals(this.root, this.currentSession) ?? [];
  }
}

function isAllowed(policy: PolicyEngine, command: string): boolean {
  return policy.check({ category: 'execution', command }).policy === 'allow';
}

function reportDecision(entry: CommandDecisionEvent): void {
  const record = { type: 'command_decision', ...entry };

  if (entry.decision === 'deny') {
    reportError(record);
    return;
  }

  reportDebug(record);
}

/**
 * `mkdir -p src/pages` → `mkdir *`: what a broader approval would cover. Only
 * a single simple command is broadened; anything else stays exact.
 */
export function suggestPattern(command: string): string {
  const trimmed = command.trim();
  const { parts, complex } = parseCommand(trimmed);
  const program = trimmed.split(/\s+/).at(0);
  const simple = !complex && parts.length === 1;

  if (!simple || program === undefined || program === trimmed) return trimmed;

  return `${program} *`;
}

/** A default denial, as the agent reads it: wait for a person, do not retry. */
function awaitingApproval(id: number | undefined): string {
  const request = id === undefined ? '' : ` (pedido #${String(id)})`;
  return `Negado: este comando aguarda a aprovação de uma pessoa${request}. Não repita este comando nem variações dele; continue com outra parte da tarefa ou termine o turno e espere.`;
}
