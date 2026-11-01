import type { ProgramCommand, ProgramOutput } from '../execute/types';
import type { AgentPolicy } from '../policy/policy.interface';

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
  | {
      /**
       * A piece of the model's text as it is written. The whole message
       * still follows as `output` or `ask`: only showing it early is up to
       * whoever reads the events.
       */
      readonly type: 'partial';
      readonly text: string;
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
 * Every provider takes the same options: an agent is configured the same way
 * whatever the CLI. CLI-specific behavior is derived from what is common (the
 * sandbox, `permissions`), never configured per provider.
 */
export interface ProviderOptions {
  readonly model: string;
  readonly executable?: string;
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

export interface Provider<TInput, TOutput> {
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
   * What of the host its CLI needs: the paths where it keeps state (mounted
   * in the sandbox; nothing else of the home is), and its own credentials,
   * files and variables. Any other known credential stays out of the sandbox.
   */
  hostAccess?(): HostAccess;
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

/** What of the host a provider's CLI needs (see `Provider.hostAccess`). */
export interface HostAccess {
  /** Host paths (dirs or files) where the CLI keeps state; mounted writable. */
  readonly state: readonly string[];
  /** Credential files among them the CLI uses to log in. */
  readonly credentialFiles: readonly string[];
  /** Environment variables with the CLI's own credentials. */
  readonly credentialEnv: readonly string[];
}
