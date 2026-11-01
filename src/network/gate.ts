import { createProducer } from '../events/index';
import { log } from '../logger/index';
import type { ApprovalScope } from '../store/index';
import type {
  NetworkApprover,
  NetworkDecision,
  NetworkDecisionData,
  NetworkDecisionSource,
  NetworkLedger,
  NetworkRequest,
} from './types';
import {
  decideByRules,
  validateNetworkRules,
  type NetworkRuleDecision,
  type NetworkRules,
} from './rules';

/** Every connection the gate decides: `type: 'decision'`, NetworkDecisionData. */
export const NETWORK_SOURCE = 'network';
const networkEvents = createProducer(NETWORK_SOURCE);

export interface NetworkGateOptions {
  /** Only the network's rules: `networkRulesOf(policy)`. */
  readonly rules: NetworkRules;
  /** Asks someone about what the rules leave open (`requireApproval`). */
  readonly approve: NetworkApprover;
  /**
   * Where approvals and decisions are kept. Without one, approvals last for
   * this gate only and nothing is recorded.
   */
  readonly ledger?: NetworkLedger;
  /**
   * `host:port` always allowed, whatever the rules say (an agent's model
   * API: denying it would only stop the agent from talking at all).
   */
  readonly alwaysAllow?: readonly string[];
  /** `host:port` always denied, without asking or recording. */
  readonly alwaysDeny?: readonly string[];
}

/**
 * Decides whether a connection leaving the sandbox may go: `alwaysAllow` and
 * `alwaysDeny`, then the rules, then the ledger's approvals, then `approve`.
 * It only decides: what was approved and what was decided is the ledger's
 * to keep; who is told, the events'.
 */
export class NetworkGate {
  private readonly ledger: NetworkLedger;
  /** Approvals are asked one at a time, never interleaved. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Connections to a destination already being asked wait for that answer. */
  private readonly asking = new Map<string, Promise<NetworkDecision>>();

  public constructor(private readonly options: NetworkGateOptions) {
    validateNetworkRules(options.rules);
    this.ledger = options.ledger ?? memoryLedger();
  }

  public decide(request: NetworkRequest): Promise<NetworkDecision> {
    const destination = destinationOf(request);

    if (this.options.alwaysAllow?.includes(destination) === true) {
      // Not stored: it is the CLI talking to its model, not the agent.
      return Promise.resolve(
        this.audited(request, 'allow', 'provider', 'Endereço do provider.'),
      );
    }

    if (this.options.alwaysDeny?.includes(destination) === true) {
      // Not stored either: the CLI's own background traffic, nobody's request.
      return Promise.resolve(
        this.audited(
          request,
          'deny',
          'provider',
          'Bloqueado pelo provider: a CLI não precisa deste endereço.',
        ),
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

    const saved = this.ledger.approval(destination);
    if (saved !== undefined) {
      return this.resolved(request, 'allow', 'saved', saved);
    }
    if (decision.policy === 'deny') {
      const id = this.keep(request, 'deny', 'default', decision.reason);
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
  private policyDecision(request: NetworkRequest): NetworkRuleDecision {
    return decideByRules(this.options.rules, destinationOf(request));
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
    if (scope === 'session' || scope === 'workspace') {
      this.ledger.remember(destination, scope);
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
    this.keep(request, decision, source, reason, options);
    return this.audited(request, decision, source, reason);
  }

  private keep(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    decidedBy: Exclude<NetworkDecisionSource, 'provider'>,
    reason: string,
    { scope }: { readonly scope?: ApprovalScope } = {},
  ): number | undefined {
    return this.ledger.record({
      destination: destinationOf(request),
      decision,
      decidedBy,
      reason,
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /**
   * Tells whoever subscribed to `network` and the log. `reason` is what the
   * CLI gets back (the proxy's 403).
   */
  private audited(
    request: NetworkRequest,
    decision: NetworkDecision['decision'],
    source: NetworkDecisionSource,
    reason: string,
  ): NetworkDecision {
    const data: NetworkDecisionData = {
      ...request,
      decision,
      reason,
      decidedBy: source,
    };
    networkEvents.emit({ type: 'decision', ...data });
    logDecision(data);
    return { decision, reason };
  }
}

/**
 * A denial is kept in the log even without `debug`, as the execution gate's;
 * the provider's own background traffic it blocks is not one.
 */
function logDecision(data: NetworkDecisionData): void {
  const record = { type: 'network_decision', ...data };
  if (data.decision === 'deny' && data.decidedBy !== 'provider') {
    log.error(record);
    return;
  }
  log.debug(record);
}

/** No ledger: approvals for this gate's life only, nothing recorded. */
function memoryLedger(): NetworkLedger {
  const approved = new Set<string>();
  return {
    approval: (destination) =>
      approved.has(destination) ? 'Aprovado nesta sessão.' : undefined,
    remember: (destination) => {
      approved.add(destination);
    },
    record: () => undefined,
  };
}

/** A default denial, as the agent reads it: wait for a person, do not retry. */
function awaitingApproval(id: number | undefined): string {
  const request = id === undefined ? '' : ` (pedido #${String(id)})`;
  return `Negado: este destino aguarda a aprovação de uma pessoa${request}. Não tente de novo nem outro caminho para ele; continue com outra parte da tarefa ou termine o turno e espere.`;
}

function destinationOf(request: NetworkRequest): string {
  return `${request.hostname}:${String(request.port)}`;
}
