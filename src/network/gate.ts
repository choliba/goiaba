import { PolicyEngine, type AgentPolicy, type PolicyDecision } from '../policy';
import { UsageError } from '../errors';
import type { ApprovalScope, Store } from '../store/index';
import type {
  NetworkApprover,
  NetworkAudit,
  NetworkDecision,
  NetworkDecisionSource,
  NetworkRequest,
} from './types';

export interface NetworkGateOptions {
  readonly permissions: AgentPolicy;
  readonly approve: NetworkApprover;
  /** Workspace root and provider, as decisions and approvals are kept. */
  readonly root: string;
  readonly provider: string;
  readonly store?: Store;
  /**
   * `host:port` the agent's CLI needs to work (its model API). Always
   * allowed: denying them would only stop the agent from talking at all.
   */
  readonly endpoints?: readonly string[];
  readonly audit?: NetworkAudit;
}

/**
 * Decides whether a connection leaving the sandbox may go: the provider's own
 * endpoints, then the policy, then approvals
 * given before, then the approver. Every decision is recorded, as the
 * execution gate's: a default denial waits on the approvals screen.
 */
export class NetworkGate {
  private readonly policy: PolicyEngine;
  private readonly sessionApprovals = new Set<string>();
  private session: string | undefined;
  /** Approvals are asked one at a time, never interleaved. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Connections to a destination already being asked wait for that answer. */
  private readonly asking = new Map<string, Promise<NetworkDecision>>();

  public constructor(private readonly options: NetworkGateOptions) {
    rejectInvalidHosts(options.permissions);
    this.policy = new PolicyEngine(options.permissions);
  }

  public setSession(id: string): void {
    this.session = id;
  }

  public decide(request: NetworkRequest): Promise<NetworkDecision> {
    const destination = destinationOf(request);

    if (this.options.endpoints?.includes(destination) === true) {
      // Not stored: it is the CLI talking to its model, not the agent.
      return Promise.resolve(
        this.audited(request, 'allow', 'provider', 'Endereço do provider.'),
      );
    }

    const decision = this.policyDecision(request);

    if (decision.policy === 'allow') {
      return this.resolved(request, 'allow', 'policy', decision.reason);
    }
    // An explicit `deny` rule always wins, even over approvals.
    if (decision.source === 'deny') {
      return this.resolved(request, 'deny', 'policy', decision.reason);
    }

    const saved = this.savedApproval(destination);
    if (saved !== undefined) {
      return this.resolved(request, 'allow', 'saved', saved);
    }
    if (decision.policy === 'deny') {
      const id = this.store(request, 'deny', 'default', decision.reason);
      return Promise.resolve(
        this.audited(request, 'deny', 'default', awaitingApproval(id)),
      );
    }

    const pending = this.asking.get(destination);
    if (pending !== undefined) return pending;
    const asked = this.enqueue(request, decision.reason).finally(() => {
      this.asking.delete(destination);
    });
    this.asking.set(destination, asked);
    return asked;
  }

  /** `host` patterns cover every port; `host:port` only that one. */
  private policyDecision(request: NetworkRequest): PolicyDecision {
    return this.policy.check({
      category: 'network',
      operation: 'connect',
      host: destinationOf(request),
    });
  }

  /** This session's approvals, then the store's (a `once` is used up). */
  private savedApproval(destination: string): string | undefined {
    if (this.sessionApprovals.has(destination)) {
      return 'Aprovado nesta sessão.';
    }

    const approval = this.options.store
      ?.activeApprovals(this.options.root, this.session, 'network')
      .find((item) => item.pattern === destination);
    if (approval === undefined) return undefined;
    if (approval.kind === 'once') {
      this.options.store?.consumeApproval(approval.id);
      return 'Aprovado uma vez.';
    }
    return 'Aprovado para este workspace.';
  }

  private enqueue(
    request: NetworkRequest,
    reason: string,
  ): Promise<NetworkDecision> {
    const ask = (): Promise<NetworkDecision> => this.ask(request, reason);
    const result = this.queue.then(ask, ask);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async ask(
    request: NetworkRequest,
    reason: string,
  ): Promise<NetworkDecision> {
    const destination = destinationOf(request);
    const scope = await this.options
      .approve({ ...request, reason, pattern: destination })
      .catch((): ApprovalScope => 'deny');

    if (scope === 'deny') {
      return this.record(request, 'deny', 'human', 'Negado pelo usuário.', {
        scope,
      });
    }
    if (scope === 'session') this.sessionApprovals.add(destination);
    if (scope === 'workspace') {
      // Given at the prompt: the connection already went through.
      this.options.store?.saveApproval({
        root: this.options.root,
        pattern: destination,
        kind: 'workspace',
        category: 'network',
        notified: true,
      });
    }
    return this.record(request, 'allow', 'human', 'Aprovado pelo usuário.', {
      scope,
    });
  }

  private resolved(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    source: Exclude<NetworkDecisionSource, 'provider'>,
    reason: string,
  ): Promise<NetworkDecision> {
    return Promise.resolve(this.record(request, decision, source, reason));
  }

  private record(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    source: Exclude<NetworkDecisionSource, 'provider'>,
    reason: string,
    options: { readonly scope?: ApprovalScope } = {},
  ): NetworkDecision {
    this.store(request, decision, source, reason, options);
    return this.audited(request, decision, source, reason);
  }

  private store(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    source: Exclude<NetworkDecisionSource, 'provider'>,
    reason: string,
    { scope }: { readonly scope?: ApprovalScope } = {},
  ): number | undefined {
    return this.options.store?.recordDecision({
      session: this.session,
      provider: this.options.provider,
      root: this.options.root,
      command: destinationOf(request),
      category: 'network',
      decision,
      source,
      ...(scope === undefined ? {} : { scope }),
      reason,
    });
  }

  /** `reason` is what the CLI gets back (the proxy's 403). */
  private audited(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    source: NetworkDecisionSource,
    reason: string,
  ): NetworkDecision {
    this.options.audit?.({ ...request, decision, reason, source });
    return { decision, reason };
  }
}

/** A default denial, as the agent reads it: wait for a person, do not retry. */
function awaitingApproval(id: number | undefined): string {
  const request = id === undefined ? '' : ` (pedido #${String(id)})`;
  return `Negado: este destino aguarda a aprovação de uma pessoa${request}. Não tente de novo nem outro caminho para ele; continue com outra parte da tarefa ou termine o turno e espere.`;
}

/**
 * A URL or a path never matches a destination: refuse it instead of letting
 * the rule silently do nothing.
 */
function rejectInvalidHosts(policy: AgentPolicy): void {
  for (const source of ['allow', 'requireApproval', 'deny'] as const) {
    for (const rule of policy[source]?.network ?? []) {
      for (const host of [...rule.hosts, ...(rule.ignores?.hosts ?? [])]) {
        if (host.includes('/')) {
          throw new UsageError(
            `Host inválido em ${source}.network: ${host}. Use só o host, com porta opcional (ex.: duckduckgo.com ou duckduckgo.com:443).`,
          );
        }
      }
    }
  }
}

function destinationOf(request: NetworkRequest): string {
  return `${request.hostname}:${String(request.port)}`;
}
