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
  | {
      /** What the model thought before answering, when the CLI reports it. */
      readonly type: 'reasoning';
      readonly text: string;
    }
  | ToolEvent;

/** What a model's traffic says as it passes. */
export type TrafficEvent =
  | { readonly type: 'text'; readonly text: string }
  /** A piece of what the model thinks before answering. */
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'usage'; readonly usage: TokenUsage };

/** Tokens of one request to the model. */
export interface TokenUsage {
  /** What the model read: instructions, tools, conversation, message. */
  readonly input: number;
  /** What it wrote, reasoning included. */
  readonly output: number;
  /** Of `input`, what the model already had and did not read again. */
  readonly cachedInput?: number;
  /** Of `output`, the reasoning before the answer. */
  readonly reasoning?: number;
}

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
   * What the model says as it passes, read from what one of its
   * `networkEndpoints` sends back on a connection: each piece of the
   * answer's text and each request's usage. Only where that traffic is
   * readable (a local model over plain HTTP).
   */
  readTraffic?(
    responses: AsyncIterable<Uint8Array>,
  ): AsyncIterable<TrafficEvent>;
  /**
   * The turn's command with its CLI's stdin kept open: messages sent while
   * it runs go to the same process, which answers them in order. Only where
   * the CLI takes messages that way.
   */
  createLiveTurn?(input: string, sessionId?: string): LiveTurn;
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

/**
 * A turn that takes messages while it runs. Its stdin closes once every
 * message sent has been answered: the CLI then exits, as any turn does.
 */
export interface LiveTurn {
  readonly command: ProgramCommand;
  /**
   * The message to the running CLI, after the ones before it. `false` once
   * the turn takes no more (it is finishing): send it as the next turn.
   */
  send(message: string): boolean;
  /** Takes no more messages and closes stdin (the turn ended or stopped). */
  close(): void;
}
