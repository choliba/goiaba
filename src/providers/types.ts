import type { ProgramCommand, ProgramOutput } from '../execute/types';
import type { AgentPolicy } from '../policy/policy.interface';
import type { GoiabaTool } from './tools';

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
  | {
      /**
       * What the CLI itself wrote on stderr (a warning, an error of its
       * own): shown and logged, never taken as what the model said.
       */
      readonly type: 'stderr';
      readonly text: string;
    }
  | {
      /** Tokens of one request to the model, as the CLI reports them. */
      readonly type: 'usage';
      readonly usage: TokenUsage;
      /** What the request did, when the CLI says: the tools it called. */
      readonly action?: string;
    }
  | {
      /**
       * What the CLI says its run cost so far, in USD, beyond what it already
       * reported: a run's cost, not one request's.
       */
      readonly type: 'cost';
      readonly usd: number;
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
  /** Of `input`, what was written to the cache for the next requests. */
  readonly cacheWrite?: number;
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
 * sandbox, `policy`), never configured per provider.
 */
export interface ProviderOptions {
  readonly model: string;
  readonly executable?: string;
}

/**
 * Where execution decisions are made. The provider wires its CLI's PreToolUse
 * hook to `hookCommand`; the hook asks Goiaba's policy engine, so every CLI
 * enforces the same `policy.execution`.
 */
export interface ExecutionGate {
  /** argv of the hook, runnable inside the sandbox. */
  readonly hookCommand: readonly string[];
  /** Workspace root, for CLI state kept per workspace. */
  readonly root: string;
  /**
   * The workspace's home: where the CLI's gate files live, and the home the
   * CLI runs with when isolated from the host's.
   */
  readonly home?: string;
  /**
   * With `hostState: 'share'`, the host home whose CLI state the CLI uses.
   * The gate's files still go in `home`, never into the host's state.
   */
  readonly sharedHome?: string;
}

/** Which provider, model and CLI an agent runs on; every record of it says so. */
export interface ProviderDescription {
  readonly name: string;
  readonly model: string;
  /** The CLI it drives, when the provider can drive more than one. */
  readonly cli?: string;
  /**
   * Tokens of context the CLI is told the model has (where it compacts the
   * history), when the provider sets it: Ollama's `contextWindow`.
   */
  readonly contextWindow?: number;
  /**
   * Of that window, the tokens left for what the model reads: what the CLI
   * keeps for the reply taken out (Claude Code), or up to where it compacts
   * (Codex). Past it the history is compacted.
   */
  readonly readableContext?: number;
  /** `false` when the provider turns the model's thinking off; left out, the model's default. */
  readonly think?: boolean;
  /** The capabilities the model sees, when the provider restricts them. */
  readonly tools?: readonly GoiabaTool[];
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
   * The new body of a request its CLI sends to one of its
   * `networkEndpoints`, or `undefined` to send it as it came: an option the
   * model takes that the CLI does not send. Applied where that traffic
   * passes through Goiaba (the network boundary, with a policy).
   */
  rewriteRequest?(request: ModelRequest): Uint8Array | undefined;
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
  applyPolicy?(
    policy: AgentPolicy,
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

/**
 * What of the host a provider's CLI needs (see `Provider.hostAccess`). The
 * CLI runs with a home of its own, one per workspace: none of the user's
 * CLI state (`~/.claude`, `~/.codex`, `~/.cursor`) reaches the sandbox,
 * unless the workspace shares it on purpose (`hostState: 'share'`).
 */
export interface HostAccess {
  /** Where the CLI is installed (its versions): mounted read-only. */
  readonly programs?: readonly string[];
  /**
   * Host files the CLI logs in with, under the user's home: with
   * `hostState: 'login'`, each is mounted read-only at the same place in
   * the workspace's home.
   */
  readonly credentialFiles: readonly string[];
  /** Environment variables with the CLI's own credentials. */
  readonly credentialEnv: readonly string[];
  /**
   * Variables that point the CLI to its state, as paths relative to the
   * home (`{ CODEX_HOME: '.codex' }`), for CLIs that read them.
   */
  readonly homeEnv?: Readonly<Record<string, string>>;
  /** With `hostState: 'share'` only: the CLI's state on the host, writable. */
  readonly sharedState: readonly string[];
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

/** A request to the model's API, whole, as `rewriteRequest` gets it. */
export interface ModelRequest {
  readonly method: string;
  /** As in the request line: `/v1/messages?beta=true`. */
  readonly path: string;
  readonly body: Uint8Array;
}
