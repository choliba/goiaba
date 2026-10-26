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

export interface NetworkDecisionEvent extends NetworkRequest {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
  readonly source: NetworkDecisionSource;
}

export type NetworkAudit = (event: NetworkDecisionEvent) => void;
