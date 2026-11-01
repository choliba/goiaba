import type { Executor } from '../execute/index';
import type { OutputDispatcher } from '../execute/index';
import type { Interaction } from '../interaction/index';
import type { Provider, ProviderEvent } from '../providers/types';
import type { Workspace } from '../workspace/index';
import type { AgentPolicy } from '../policy/policy.interface';
import type { CommandApprover } from '../approval/gate';
import type { AgentOutput } from './output';
import type { Store } from '../store/index';

export type AgentProvider = Provider<string, string>;

/** Where the agent is in its life: see run, pause, stop, reset, destroy. */
export type AgentStatus =
  'idle' | 'running' | 'paused' | 'stopped' | 'destroyed';

/**
 * Receives everything the agent reports, one `AgentOutput` at a time:
 * `output.agent()`, `output.type()`, `output.data()`…
 */
export type AgentSubscriber = (output: AgentOutput) => void;

/** Answers the agent's question; `signal` cancels it (e.g. an approval came first). */
export type AgentAsk = (
  question: string,
  signal?: AbortSignal,
) => Promise<string>;

export interface AgentOptions {
  /**
   * Identifies the agent: every activity it reports carries `agent: name`,
   * and its sessions keep it.
   */
  readonly name: string;
  readonly prompt: string;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  /** Runs the CLI; defaults to a new one. */
  readonly executor?: Executor;
  /** Where every CLI turn's events are also published, for whoever follows them all. */
  readonly output?: OutputDispatcher<ProviderEvent<string>>;
  readonly interaction?: Interaction;
  readonly permissions?: AgentPolicy;
  /** Stops the agent: kills the CLI and closes the workspace. Defaults to the runScript signal. */
  readonly signal?: AbortSignal;
  /**
   * Decides commands the policy sends to approval (`requireApproval`, or
   * `default` when it is not allow/deny). Defaults to asking through
   * `interaction`.
   */
  readonly approve?: CommandApprover;
  /** Sessions, decisions and approvals; defaults to the config's `database`. */
  readonly store?: Store;
  /**
   * Waits for the next message after every turn (a chat), ending only when
   * stopped. Default `true`; `false` ends when the agent stops asking (a
   * one-shot task).
   */
  readonly conversation?: boolean;
  /** Functions that receive everything the agent reports, as it happens. */
  readonly subscribe?: readonly AgentSubscriber[];
}
