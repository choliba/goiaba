/**
 * A round's record: everything one run of a round measured, in one JSON file
 * that can be read alone, years later. It is the source of the rounds' pages
 * (rounds/web), so it only refers to other modules' types, never to their
 * code: every import here is `import type`.
 */

import type { NetworkRules } from '../network/rules';
import type { AgentPolicy } from '../policy/policy.interface';

// Copies of unions whose modules reach Node (the store, the sandbox): the
// pages could not compile them. `compat.ts` fails the typecheck if a copy
// drifts from its original.

/** `WorkspaceType` of src/workspace. */
export type RoundWorkspaceType = 'docker' | 'bubblewrap';
/** `HostState` of src/workspace. */
export type RoundHostState = 'login' | 'none' | 'share';
/** `NetworkDecisionSource` of src/network. */
export type RoundDecisionSource =
  'policy' | 'default' | 'provider' | 'human' | 'saved';

/** The version of this shape; a record with another one is refused. */
export const ROUND_SCHEMA = 3;

/** One run of a round. */
export interface RoundRecord {
  readonly schema: typeof ROUND_SCHEMA;
  /** Unique: the start time, `2026-11-03T16-50-30.759Z`. Also the file name. */
  readonly id: string;
  /** Which declaration ran, and what it wants to find out. */
  readonly definition: RoundDefinitionRef;
  /**
   * What changed in this run, in the words of whoever ran it (`troquei o
   * modelo para o qwen3.5:4b`); absent when nobody said. Not in `configHash`.
   */
  readonly label?: string;
  /** Where the workspace started from; `null` when the round has no git start. */
  readonly start: RoundStart | null;
  /** This run among the repetitions of the same declaration. */
  readonly repeat: RoundRepeat;
  readonly timing: RoundTiming;
  /** Each agent's pieces, as used, by the agent's name. */
  readonly actors: Readonly<Record<string, ActorSnapshot>>;
  /** Over the declaration and every actor's `configHash`: same hash, a repetition. */
  readonly configHash: string;
  /** What each agent did, in order. */
  readonly steps: readonly RoundStep[];
  /** Tokens, one record per request to a model. */
  readonly usage: readonly UsageRecord[];
  /** What each agent and the whole round cost and consumed. */
  readonly totals: RoundTotals;
  /** Counts per agent, by name. */
  readonly measures: Readonly<Record<string, ActorMeasures>>;
  /** The result of every rule the declaration checks. */
  readonly violations: readonly RuleResult[];
  /**
   * What the declaration expected of this run, copied so the record can be
   * scored alone: the answer key and the limits. Absent when it declared
   * neither.
   */
  readonly criteria?: RoundCriteria;
}

export interface RoundDefinitionRef {
  /** The declaration's id: `analise-programacao-revisao`. */
  readonly id: string;
  /**
   * What the round wants to find out, in the user's language. Empty in the
   * rounds that ran before declarations had one (agents/02.ts).
   */
  readonly goal: string;
}

export interface RoundStart {
  /** The git tag every run of the round starts from. */
  readonly tag: string;
  /** Its short commit. */
  readonly commit: string;
}

export interface RoundRepeat {
  /** 1-based. */
  readonly index: number;
  readonly total: number;
}

/** A span of time: ISO dates and the duration between them, in ms. */
export interface Span {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
}

export interface RoundTiming extends Span {
  /** Per agent, by name: from its first turn to its last. */
  readonly actors: Readonly<Record<string, ActorTiming>>;
}

export interface ActorTiming extends Span {
  /** Starting the sandbox and the network boundary; `null` when not measured. */
  readonly workspaceMs: number | null;
  /** Comparing the workspace's git before and after the agent. */
  readonly gitCheckMs: number | null;
  /** Waiting for approvals, summed. */
  readonly approvalMs: number | null;
}

/** An agent's pieces, copied from the real objects when it starts. */
export interface ActorSnapshot {
  /** Its role in the round: `analista`. */
  readonly role: string;
  readonly provider: ProviderSnapshot;
  readonly workspace: WorkspaceSnapshot;
  readonly network: NetworkSnapshot;
  /** The policy it ran under, whole; `null` when it had none. */
  readonly policy: AgentPolicy | null;
  /** Told not to change any file: the git checks it. */
  readonly readOnly: boolean;
  /** Over everything above but the prompts: same hash, same configuration. */
  readonly configHash: string;
}

export interface ProviderSnapshot {
  /** `provider.id`: `claude`, `cursor`. */
  readonly id: string;
  readonly name: string;
  readonly model: string;
  /** The CLI it drove, when it can drive more than one. */
  readonly cli: string | null;
  /** `<cli> --version`, when known. */
  readonly cliVersion: string | null;
  /** The options it was created with (credentials never). */
  readonly options: Readonly<Record<string, unknown>>;
}

export interface WorkspaceSnapshot {
  readonly type: RoundWorkspaceType;
  /** Docker only. */
  readonly image: string | null;
  /** With the project's path as `<projeto>` and the home as `~`. */
  readonly root: string;
  readonly writable: readonly string[];
  readonly hostState: RoundHostState;
  readonly ports: readonly number[];
}

export interface NetworkSnapshot {
  /** The policy's network rules; `null` without rules (the host's network). */
  readonly rules: NetworkRules | null;
  /** `host:port` the provider's CLI needs, let through whatever the rules say. */
  readonly alwaysAllow: readonly string[];
  /** `host:port` it must not reach, denied without asking. */
  readonly alwaysDeny: readonly string[];
  /** What the network actually decided during the agent's run, in order. */
  readonly decisions: readonly NetworkDecisionRecord[];
}

export interface NetworkDecisionRecord {
  readonly ts: string;
  /** `host:port`. */
  readonly destination: string;
  readonly protocol: 'http' | 'https';
  readonly decision: 'allow' | 'deny';
  readonly decidedBy: RoundDecisionSource;
  readonly reason: string;
}

/** What a round's declaration expects, to score it (see `src/rounds/score.ts`). */
export interface RoundCriteria {
  /**
   * The answer key, by actor: what its answer must contain, one point per
   * entry (`usuariosPadrao`, `Object.freeze`). Found when the text appears in
   * what it said, ignoring case.
   */
  readonly expected?: Readonly<Record<string, readonly string[]>>;
  /** Limits set before the run: meeting them is part of the goal. */
  readonly limits?: RoundLimits;
}

export interface RoundLimits {
  /** The whole round, wall clock, in ms. */
  readonly roundMs?: number;
  /** Each actor's time, the sum of its steps, in ms. */
  readonly actorMs?: Readonly<Record<string, number>>;
  /** The whole round, in USD. */
  readonly costUsd?: number;
}

/** What an agent did in one step of the flow. */
export interface RoundStep {
  /**
   * Stable across rounds: the actor and which of its steps (`analista#1`).
   * Rounds are compared, and charted, by this key, not by position.
   */
  readonly key: string;
  readonly actor: string;
  /** Who consulted it, when someone did. */
  readonly by: string | null;
  readonly prompt: Prompt;
  readonly span: Span;
  /** Everything the model said, in order. */
  readonly said: readonly string[];
  /** Questions it asked anyway, answered by the round. */
  readonly asked: readonly string[];
  readonly turns: readonly TurnRecord[];
  readonly tools: readonly ToolRecord[];
  /**
   * `git status --porcelain` lines of the files it changed. Empty also when
   * the round has no git `start`: then nothing checked it.
   */
  readonly changed: readonly string[];
  /** What it changed (`git diff`), empty when nothing. */
  readonly diff: string;
  /** Tokens and cost of this step: the sum of its `usage` records. */
  readonly totals: UsageTotal;
  /**
   * The `file:line` references in what it said, checked against the
   * workspace at the round's start; `null` when there was no git start.
   */
  readonly references: References | null;
}

export interface References {
  /** Distinct references cited. */
  readonly cited: number;
  /** Of them, the file exists and the line is within it. */
  readonly valid: number;
  /** The ones that are not, as cited. */
  readonly invalid: readonly string[];
}

export interface Prompt {
  readonly text: string;
  /** sha256 of `text`, hex. */
  readonly hash: string;
}

/** One CLI turn: from the message to the answer. */
export interface TurnRecord {
  /** 1-based, within the step. */
  readonly index: number;
  readonly span: Span;
}

/** One tool the CLI used: from its call to its result. */
export interface ToolRecord {
  /** The turn it ran in. */
  readonly turn: number;
  /** As the CLI names it: `Bash`, `Read`, `shell`. */
  readonly name: string;
  /** What the CLI reported: command, path, exit code… */
  readonly detail: Readonly<Record<string, unknown>>;
  readonly outcome: 'result' | 'error' | 'unfinished';
  readonly span: Span;
}

/**
 * What a CLI reported consuming: one request's tokens (and their price, when
 * known), or the cost of its run, with no tokens.
 */
export interface UsageRecord {
  readonly ts: string;
  readonly actor: string;
  /** The position in `steps` of the step it belongs to. */
  readonly step: number;
  /** The turn of that step. */
  readonly turn: number;
  /** What caused it, when the CLI says: a tool, a message. */
  readonly action: string | null;
  readonly tokens: TokenCounts;
  /** USD; `null` when neither the CLI nor the price table gives it. */
  readonly costUsd: number | null;
  readonly costSource: CostSource | null;
}

/** `cli`: the CLI reported it. `table`: computed from the price table. */
export type CostSource = 'cli' | 'table';

/** Tokens, each kind `null` when the CLI does not report it. */
export interface TokenCounts {
  /** Everything the model read, the cache included. */
  readonly input: number | null;
  /** What it wrote, reasoning included. */
  readonly output: number | null;
  /** Of `input`, what came from the cache. */
  readonly cacheRead: number | null;
  /** Of `input`, what was written to the cache. */
  readonly cacheWrite: number | null;
  /** Of `output`, the reasoning before the answer. */
  readonly reasoning: number | null;
}

/** Sums of what was measured: `null` only when nothing was. */
export interface RoundTotals {
  readonly round: UsageTotal;
  /** By the agent's name. */
  readonly actors: Readonly<Record<string, UsageTotal>>;
}

export interface UsageTotal {
  readonly tokens: TokenCounts;
  /**
   * New tokens: what the model read that did not come from the cache
   * (`input - cacheRead`), plus what it wrote. The effort of the work;
   * efficiency is scored on it. `null` when not measured.
   */
  readonly fresh: number | null;
  readonly costUsd: number | null;
}

export interface ActorMeasures {
  readonly turns: number;
  readonly tools: number;
  readonly questions: number;
  readonly changedFiles: number;
  /** `null` when the round does not run them. */
  readonly tests: CheckResult | null;
  readonly typecheck: CheckResult | null;
}

export interface CheckResult {
  readonly passed: boolean;
  /** The command that ran. */
  readonly command: string;
  readonly summary: string;
}

/** A rule of the round, checked from outside the agents (the git, the events). */
export interface RuleResult {
  /** `read-only-respected`. */
  readonly rule: string;
  /** The agent it is about; `null` for the whole round. */
  readonly actor: string | null;
  readonly passed: boolean;
  /** Why, in the user's language. */
  readonly detail: string;
}
