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
export const ROUND_SCHEMA = 4;

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
   * The limits the declaration set, copied so the record can be scored
   * alone. Absent when it set none.
   */
  readonly criteria?: RoundCriteria;
  /**
   * The declaration as it ran, as data: enough to write it back
   * (`declarationSource`). Absent in records from before it was kept.
   */
  readonly declaration?: RoundDeclaration;
  /**
   * What the machine was and how much of it the round used (CPU/GPU/RAM),
   * sampled over time. Of the round, not of any provider: which model ran is
   * in `actors`. Volatile, so out of `configHash`. Absent in records from
   * before it was measured, or when the machine could not be read.
   */
  readonly resources?: RoundResources;
}

/**
 * The machine a round ran on, read once at the start. No provider or model
 * here: that lives in each `ActorSnapshot`.
 */
export interface MachineSnapshot {
  /** `Linux 7.0.0-42-generic`: kernel type and release. */
  readonly os: string;
  /** The Bun runtime's version. */
  readonly bun: string;
  readonly cpu: {
    readonly model: string;
    /** Logical processors. */
    readonly cores: number;
  };
  readonly memTotalMb: number;
  /** `null` when there is no NVIDIA GPU, or `nvidia-smi` is absent. */
  readonly gpu: {
    readonly name: string;
    readonly memTotalMb: number;
    readonly driver: string;
  } | null;
}

/** One reading of the machine's use, taken every `RoundResources.intervalMs`. */
export interface ResourceSample {
  readonly ts: string;
  /** Whole-machine CPU use since the previous sample, 0–100. */
  readonly cpuPct: number;
  readonly memUsedMb: number;
  /** `null` when the machine has no GPU, or the query failed this time. */
  readonly gpu: {
    readonly utilPct: number;
    readonly memUsedMb: number;
    /** Watts; `null` when the driver does not report it. */
    readonly powerW: number | null;
    /** Celsius; `null` when the driver does not report it. */
    readonly tempC: number | null;
  } | null;
}

/** Average and peak of a set of samples. */
export interface ResourceSummary {
  readonly cpu: { readonly avgPct: number; readonly peakPct: number };
  readonly mem: { readonly avgMb: number; readonly peakMb: number };
  /** `null` when no sample in the set had a GPU reading. */
  readonly gpu: {
    readonly avgUtilPct: number;
    readonly peakUtilPct: number;
    readonly avgMemMb: number;
    readonly peakMemMb: number;
    /** Power integrated over time, Wh; `null` when no sample reported power. */
    readonly energyWh: number | null;
  } | null;
}

/** A round's resource use: the machine, the raw samples and the summaries. */
export interface RoundResources {
  readonly machine: MachineSnapshot;
  readonly intervalMs: number;
  /** Every sample of the whole round, in order. */
  readonly samples: readonly ResourceSample[];
  /** Over all samples. */
  readonly round: ResourceSummary;
  /** By the agent's name: over the samples inside that agent's steps. */
  readonly actors: Readonly<Record<string, ResourceSummary>>;
}

/**
 * A round's declaration as data, captured when it runs: every option given,
 * the prompts with the place of what another agent said marked
 * (`{{said:analista}}`), the rules by id. Paths are cleaned like the rest of
 * the record (`<projeto>`, `~`).
 */
export interface RoundDeclaration {
  readonly id: string;
  readonly goal: string;
  readonly label?: string;
  readonly start:
    | { readonly fixture: string }
    | { readonly git: { readonly root: string; readonly tag: string } }
    | null;
  readonly actors: Readonly<Record<string, DeclaredActor>>;
  readonly flow: readonly DeclaredStep[];
  /** Rule ids: `read-only-respected`. */
  readonly rules: readonly string[];
  readonly instructions?: Readonly<Record<string, readonly RoundInstruction[]>>;
  readonly limits?: RoundLimits;
  readonly repeat: number;
}

export interface DeclaredActor {
  readonly provider: {
    /** `ollama`, `claude`, `cursor`, `codex`: what `describe()` says. */
    readonly name: string;
    readonly cli: string | null;
    readonly model: string | null;
    /** See `ProviderSnapshot.contextWindow`. */
    readonly contextWindow?: number;
    /** See `ProviderSnapshot.think`. */
    readonly think?: boolean;
    /** The capabilities the model saw, when restricted (`GoiabaTool`). */
    readonly tools?: readonly string[];
  };
  readonly workspace: {
    readonly type: RoundWorkspaceType;
    /** Docker only. */
    readonly image: string | null;
    readonly root: string;
    /** As declared; `null` when left to the default. */
    readonly hostState: RoundHostState | null;
  };
  readonly policy: AgentPolicy | null;
  readonly readOnly: boolean;
}

export interface DeclaredStep {
  readonly actor: string;
  readonly by: string | null;
  /**
   * The prompt's lines, with `{{said:<actor>}}` where it puts what that
   * actor said; `null` when the prompt could not be read that way.
   */
  readonly prompt: readonly string[] | null;
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
  /**
   * The fixture (`rounds/fixtures/<name>`) the round's folder was created
   * from; `null` from a repository that already existed. Absent in records
   * from before fixtures.
   */
  readonly fixture?: string | null;
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
  /**
   * Tokens of context the CLI was told the model has (`describe()`), when
   * the provider sets it: what a step's peak context is compared with.
   */
  readonly contextWindow?: number;
  /** Of it, what the model can read before the CLI compacts (`describe()`). */
  readonly readableContext?: number;
  /** `false` when the model's thinking was off (`describe()`). */
  readonly think?: boolean;
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

/** What a round's declaration sets, to score it (see `src/rounds/score.ts`). */
export interface RoundCriteria {
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

/**
 * What must be true in the workspace: a file is there (holding a passage,
 * ignoring case), or the agent changed nothing in its step.
 */
export type RoundCheck =
  | {
      /** Relative to the workspace's root: `tickets/ticket-01.txt`. */
      readonly file: string;
      readonly contains?: string;
    }
  | { readonly unchanged: true };

/**
 * An instruction of a step's prompt that the round checks by itself: `check`
 * at the end of the step; with `when`, only if it held at the start of the
 * step (before the agent acted), and `otherwise` when it did not.
 */
export interface RoundInstruction {
  readonly when?: { readonly file: string; readonly contains?: string };
  readonly check: RoundCheck;
  readonly otherwise?: RoundCheck;
}

/** An instruction, checked; only the verdict is kept, never the file. */
export interface InstructionResult {
  /** What was checked, written by the round: `tickets/ticket-01.txt contém "ANÁLISE TÉCNICA"`. */
  readonly check: string;
  /** The condition and whether it held at the start; `null` without one. */
  readonly when: { readonly check: string; readonly held: boolean } | null;
  readonly met: boolean;
  /** Why, in the user's language. */
  readonly detail: string;
}

// --- Criteria (new model; replaces RoundInstruction/limits as it is wired in) ---

/**
 * A criterion of a good round: an assertion about a file, a limit of
 * time/tokens/cost, or a conditional that checks one branch or the other. A
 * criterion is an object with a single key telling its kind.
 */
export type RoundCriterion =
  | { readonly file: FileCriterion }
  | { readonly limit: LimitCriterion }
  | ConditionalCriterion;

/**
 * Assertions about a file (or many, with a wildcard in `name`), all holding
 * together, checked at the end of the step. `matches` is `RegExp` as declared,
 * stored as its source in the record.
 */
export interface FileCriterion {
  /** Relative to the workspace root; wildcard `*`, `**`, `ticket-*.md`. */
  readonly name: string;
  /** With a wildcard in `name`: paths to leave out. */
  readonly ignore?: readonly string[];
  /** At the end: `true` must exist, `false` must not. */
  readonly exists?: boolean;
  /** Changed vs. the start (needs a git start): came to exist. */
  readonly created?: boolean;
  /** Changed vs. the start: ceased to exist. */
  readonly deleted?: boolean;
  /** `false` the git saw no change; `true` it changed. */
  readonly changed?: boolean;
  /** Contains ALL of these passages (case-insensitive). */
  readonly contains?: readonly string[];
  /** Matches ALL of these (record: the sources, as strings). */
  readonly matches?: readonly (RegExp | string)[];
  /** The content is exactly this. */
  readonly equals?: string;
}

/** A limit of what a step or the round may spend. */
export interface LimitCriterion {
  /** `'20s'`, `'2min'`. */
  readonly time?: string;
  /** New tokens (fresh input + output). */
  readonly tokens?: number;
  /** USD, as `'0.05'`. */
  readonly cost?: string;
}

/** A condition on a file, evaluated at the start of the step. */
export interface Condition {
  readonly name: string;
  readonly exists?: boolean;
  readonly contains?: readonly string[];
}

/**
 * `if` holds at the start of the step → the `check` criteria apply; otherwise
 * the `else` ones. (`check`, not `then`: an object with `then` is thenable.)
 */
export interface ConditionalCriterion {
  readonly if: Condition;
  readonly check: readonly RoundCriterion[];
  readonly else?: readonly RoundCriterion[];
}

/** One criterion, checked; only the verdict is kept. */
export interface CriterionResult {
  /** What was checked, in the user's language. */
  readonly description: string;
  readonly met: boolean;
  readonly detail: string;
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
  /** Its actor's checkable instructions, checked at the end of the step. */
  readonly instructions: readonly InstructionResult[];
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

/**
 * What the policy decided about a shell command the agent ran, as the
 * execution gate heard it: the reason a tool failed when the gate stopped
 * it, and what to change in the definition to allow or deny it.
 */
export interface CommandPolicyRecord {
  readonly decision: 'allow' | 'deny';
  /**
   * Who decided: a rule (`policy`), the default (`default`), a person or
   * nobody in a round (`human`), an approval given before (`saved`).
   */
  readonly decidedBy: 'policy' | 'default' | 'human' | 'saved';
  /** The policy alone, before approvals: `allow`, `deny` or `require_approval`. */
  readonly policy: 'allow' | 'deny' | 'require_approval';
  /** Which group decided: `allow`, `deny`, `requireApproval`, `default`, `approved`. */
  readonly source:
    'allow' | 'deny' | 'requireApproval' | 'default' | 'approved';
  /** The simple command whose decision won (`head -5` in `find … | head -5`). */
  readonly part: string | null;
  /** The pattern a rule for that part would take (`head *`). */
  readonly pattern: string | null;
  /** Redirection, substitution or script: no rule allows the line by itself. */
  readonly complex: boolean;
  readonly reason: string;
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
  /** The gate's decision, for a shell command it decided; absent otherwise. */
  readonly policy?: CommandPolicyRecord;
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
