import type { ProgramCommand, ProgramOutput } from '../execute/types';
import type { AgentPolicy, PolicyCategory } from '../policy/policy.interface';

/**
 * What every provider must implement: what `Provider` (types.ts) has today,
 * plus `buildPermissions`, the one place where an `AgentPolicy` becomes the
 * provider's own language. Self-contained, so types.ts can go away; not
 * wired yet.
 */
export interface Provider<TInput, TOutput, TPermissions> {
  readonly id: string;
  describe?(): ProviderDescription;
  /**
   * `host:port` its CLI needs to work (the model API). With network rules,
   * Goiaba lets them through whatever the policy says.
   */
  networkEndpoints?(): readonly string[];
  /**
   * `host:port` its CLI tries to reach but must not (e.g. the cloud API when
   * the model is local). Denied without asking: nobody should approve them.
   */
  networkBlocked?(): readonly string[];

  /**
   * The policy in this provider's own language (CLI settings, flags, rules
   * files…). Pure: it only translates; nothing is written or kept. What the
   * provider cannot express exactly is listed in `unsupported`, never dropped
   * silently.
   */
  buildPermissions(policy: AgentPolicy): ProviderPermissions<TPermissions>;

  /**
   * Applies the categories the sandbox cannot enforce (web, execution,
   * communication) through the CLI. `gate` is given when there are execution
   * rules. Returns CLI files that must stay read-only in the sandbox (e.g. its
   * hook config). Must throw a UsageError for anything it cannot apply
   * exactly; providers without it refuse those categories.
   */
  applyPermissions?(
    permissions: AgentPolicy,
    gate: ExecutionGate | undefined,
  ): readonly string[];
  createCommand(
    input: TInput,
    sessionId?: string,
    workspaceRoot?: string,
  ): ProgramCommand;
  parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<TOutput>>;
}

export type AgentEvent<TOutput> =
  | {
      readonly type: 'output';
      readonly value: TOutput;
    }
  | {
      readonly type: 'ask';
      readonly question: string;
    };

export type ProviderEvent<TOutput> =
  | AgentEvent<TOutput>
  | {
      readonly type: 'session';
      readonly id: string;
    }
  | ToolEvent;

/**
 * A tool the CLI used: its call, its result or its failure, with what the
 * CLI reported about it (tool, args, command, exit code…). The agent logs it
 * and hands it to its subscribers.
 */
export interface ToolEvent {
  readonly type: 'tool';
  readonly phase: 'call' | 'result' | 'error';
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Where execution decisions are made. The provider wires its CLI's PreToolUse
 * hook to `hookCommand`; the hook asks Goiaba's policy engine, so every CLI
 * enforces the same `permissions.execution`.
 */
export interface ExecutionGate {
  /** argv of the hook, runnable inside the sandbox. */
  readonly hookCommand: readonly string[];
  /** Workspace root, for CLI state kept per workspace. */
  readonly root: string;
}

/** Which provider, model and CLI an agent runs on; every record of it says so. */
export interface ProviderDescription {
  readonly name: string;
  readonly model: string;
  /** The CLI it drives, when the provider can drive more than one. */
  readonly cli?: string;
}

/** An `AgentPolicy` as one provider expresses it. */
export interface ProviderPermissions<TPermissions> {
  /** In the provider's own language. */
  readonly native: TPermissions;
  /** Rules it could not express exactly, and why. */
  readonly unsupported: readonly UnsupportedRule[];
}

export interface UnsupportedRule {
  readonly category: PolicyCategory;
  readonly source: 'allow' | 'requireApproval' | 'deny';
  readonly rule: unknown;
  readonly reason: string;
  /**
   * What the provider ends up doing instead: `stricter` denies something the
   * policy allows (safe); `looser` allows something it denies (not safe:
   * applying refuses it).
   */
  readonly effect: 'stricter' | 'looser';
}
