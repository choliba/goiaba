import { createProducer } from '../events/index';
import { log } from '../logger/index';
import {
  PolicyEngine,
  suggestPattern,
  type AgentPolicy,
  type CommandPolicyDecision,
} from '../policy/index';
import type { ApprovalScope, DecisionCategory, Store } from '../store/index';

export interface CommandApprovalRequest {
  /** The command, or `host:port` for `network`. */
  readonly command: string;
  /** Why the policy did not decide on its own. */
  readonly reason: string;
  /** Pattern a `session`/`workspace` approval would save. */
  readonly pattern: string;
  readonly provider: string;
  /** `execution` when left out. */
  readonly category?: DecisionCategory;
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
 * Every command the gate decides: `type: 'decision'`, CommandDecisionData.
 * Whoever wants to know why a command ran or not (a round) listens here.
 */
export const COMMAND_SOURCE = 'command';
const commandEvents = createProducer(COMMAND_SOURCE);

/** What the gate emits for each command: its decision and the policy's. */
export interface CommandDecisionData extends CommandDecisionEvent {
  /** What the policy said about the line, before approvals and people. */
  readonly policy: CommandPolicyDecision['policy'];
  /** Which of the policy's groups decided: a rule's, or the default. */
  readonly policySource: CommandPolicyDecision['source'];
  /** The simple command whose decision won (`head -5` in `find … | head -5`). */
  readonly part: string | null;
  /** The pattern an allow or deny rule for that part would take. */
  readonly pattern: string | null;
  /** Redirection, substitution or script: no rule allows it by itself. */
  readonly complex: boolean;
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
    // Approved patterns are allow rules the policy weighs with its own.
    const decision = this.policy.checkCommand(command, {
      approved: this.approvals.patterns(),
    });

    if (decision.policy === 'allow' && decision.source !== 'approved') {
      return this.record(command, 'allow', 'policy', decision.reason, {
        policy: decision,
      });
    }

    // An explicit `deny` rule always wins, even over approvals.
    if (decision.source === 'deny') {
      return this.record(command, 'deny', 'policy', decision.reason, {
        policy: decision,
      });
    }

    // An approval of this exact line covers it, even a complex one.
    const exact = this.approvals.exact(command);
    if (exact !== undefined) {
      return this.record(command, 'allow', 'saved', exact, {
        policy: decision,
      });
    }

    if (decision.policy === 'allow') {
      return this.record(command, 'allow', 'saved', decision.reason, {
        policy: decision,
      });
    }

    if (decision.policy === 'deny') {
      return this.record(command, 'deny', 'default', decision.reason, {
        policy: decision,
        // What the agent reads: a person decides, so retrying only repeats it.
        toAgent: (id) => awaitingApproval(id),
      });
    }

    return this.ask(command, decision);
  }

  private ask(
    command: string,
    policy: CommandPolicyDecision,
  ): Promise<CommandDecision> {
    const ask = (): Promise<CommandDecision> =>
      this.askApprover(command, policy);
    const result = this.queue.then(ask, ask);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async askApprover(
    command: string,
    policy: CommandPolicyDecision,
  ): Promise<CommandDecision> {
    const pattern = suggestPattern(command);
    const scope = await this.options
      .approve({
        command,
        reason: policy.reason,
        pattern,
        provider: this.options.provider,
      })
      .catch((): ApprovalScope => 'deny');

    if (scope === 'deny') {
      return this.record(command, 'deny', 'human', 'Negado pelo usuário.', {
        scope,
        policy,
      });
    }

    this.approvals.remember(scope, pattern);
    return this.record(command, 'allow', 'human', 'Aprovado pelo usuário.', {
      scope,
      policy,
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
      policy,
    }: {
      /** The policy's decision on the line. */
      readonly policy: CommandPolicyDecision;
      readonly scope?: ApprovalScope;
      /** The reason the agent gets, from the request's id, when it differs. */
      readonly toAgent?: (id: number | undefined) => string;
    },
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
    commandEvents.emit({
      type: 'decision',
      command,
      decision,
      source,
      reason,
      policy: policy.policy,
      policySource: policy.source,
      part: policy.part ?? null,
      pattern: policy.part === undefined ? null : suggestPattern(policy.part),
      complex: policy.complex,
    } satisfies CommandDecisionData & { readonly type: 'decision' });
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
   * An approval of this exact line: a one-time one (used up) or a saved
   * pattern equal to it. Covers even a complex line (a heredoc, a redirect).
   */
  public exact(command: string): string | undefined {
    if (this.consumeOnce(command)) return 'Aprovado uma vez.';
    if (this.patterns().includes(command.trim())) {
      return 'Aprovado para este workspace.';
    }
    return undefined;
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

  /** This session's and the workspace's patterns, for the policy to weigh. */
  public patterns(): string[] {
    const workspace = this.active()
      .filter((approval) => approval.kind === 'workspace')
      .map((approval) => approval.pattern);
    return [...this.sessionPatterns, ...workspace];
  }

  private active(): ReturnType<Store['activeApprovals']> {
    return this.store?.activeApprovals(this.root, this.currentSession) ?? [];
  }
}

function reportDecision(entry: CommandDecisionEvent): void {
  const record = { type: 'command_decision', ...entry };

  if (entry.decision === 'deny') {
    log.error(record);
    return;
  }

  log.debug(record);
}

/** A default denial, as the agent reads it: wait for a person, do not retry. */
function awaitingApproval(id: number | undefined): string {
  const request = id === undefined ? '' : ` (pedido #${String(id)})`;
  return `Negado: este comando aguarda a aprovação de uma pessoa${request}. Não repita este comando nem variações dele; continue com outra parte da tarefa ou termine o turno e espere.`;
}
