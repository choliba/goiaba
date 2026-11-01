import type { ApprovalScope } from '../store/index';

export interface NetworkRequest {
  readonly hostname: string;
  readonly port: number;
  readonly protocol: 'http' | 'https';
}

export interface NetworkDecision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

export interface NetworkApprovalRequest extends NetworkRequest {
  readonly reason: string;
  readonly pattern: string;
}

export type NetworkApprover = (
  request: NetworkApprovalRequest,
) => Promise<ApprovalScope>;

/**
 * `provider`: an address the agent's own CLI needs (its model API), allowed
 * whatever the policy says, or one it must not reach, denied the same way. `default`: no rule matched and the default
 * denied (an approval can change that).
 */
export type NetworkDecisionSource =
  'policy' | 'default' | 'provider' | 'human' | 'saved';

/** A decision as a ledger keeps it. */
export interface NetworkRecord {
  /** `host:port`. */
  readonly destination: string;
  readonly decision: 'allow' | 'deny';
  readonly decidedBy: Exclude<NetworkDecisionSource, 'provider'>;
  readonly reason: string;
  readonly scope?: ApprovalScope;
}

/**
 * Where the gate's approvals and decisions are kept, whoever keeps them (the
 * store, a test, nothing): the gate only asks and tells.
 */
export interface NetworkLedger {
  /** An approval for `destination` given before (a `once` is used up): why, or none. */
  approval(destination: string): string | undefined;
  /** An approval just given at the prompt, for the session or the workspace. */
  remember(destination: string, scope: 'session' | 'workspace'): void;
  /** Keeps a decision; its id is the request number a person sees. */
  record(entry: NetworkRecord): number | undefined;
}

/**
 * What the `network` producer emits for each decision (`type: 'decision'`),
 * besides the event's own `source`, `ts` and agent: `decidedBy` says which
 * step decided.
 */
export interface NetworkDecisionData extends NetworkRequest {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
  readonly decidedBy: NetworkDecisionSource;
}
