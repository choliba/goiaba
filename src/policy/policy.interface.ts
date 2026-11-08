/**
 * The one permission model of Goiaba: everything any agent may be allowed to
 * do, whatever runs it. Every provider translates from it.
 *
 * Every category has the same shape: operations, targets (with `*` and
 * `**`), and `ignores` to take targets out of a rule.
 */

export type ActionPolicy = 'allow' | 'deny' | 'require_approval';

export type FilesystemOperation = 'read' | 'write';

export interface FilesystemRule {
  readonly operations: readonly (FilesystemOperation | '*')[];
  readonly paths: readonly string[];
  readonly ignores?: { readonly paths?: readonly string[] };
}

export type WebOperation =
  'search' | 'read_text' | 'interact' | 'form_submit' | 'login' | 'browse';

export interface WebRule {
  readonly operations: readonly (WebOperation | '*')[];
  readonly domains: readonly string[];
  readonly ignores?: { readonly domains?: readonly string[] };
}

/** The one verb of execution: run a command. */
export type ExecutionOperation = 'run';

/**
 * Execution is matched by the command line (no CLI can verify intent: tests,
 * lint...). `operations` exists only to give the category the same shape as
 * the others; it has a single verb, `run`, and when left out it is assumed.
 */
export interface ExecutionRule {
  readonly operations?: readonly (ExecutionOperation | '*')[];
  readonly commands: readonly string[];
  readonly ignores?: { readonly commands?: readonly string[] };
}

export type CommunicationOperation =
  'send_email' | 'post_social_media' | 'send_logs';

export interface CommunicationRule {
  readonly operations: readonly (CommunicationOperation | '*')[];
  readonly channels: readonly string[];
  readonly ignores?: { readonly channels?: readonly string[] };
}

// Network rules are the network module's: their shape and meaning live there.
import type { NetworkOperation, NetworkRule } from '../network/rules';

export type { NetworkOperation, NetworkRule };

/** External tools, such as MCP servers. */
export type ToolOperation = 'call';

export interface ToolRule {
  readonly operations: readonly (ToolOperation | '*')[];
  /** `server/tool`: `github/create_issue`, `github/*`, `*`. */
  readonly tools: readonly string[];
  readonly ignores?: { readonly tools?: readonly string[] };
}

/** Subagents the agent starts on its own. */
export type SubagentOperation = 'spawn';

export interface SubagentRule {
  readonly operations: readonly (SubagentOperation | '*')[];
  /** Subagent name or model: `revisor`, `claude-haiku-*`, `*`. */
  readonly agents: readonly string[];
  readonly ignores?: { readonly agents?: readonly string[] };
}

/** Environment variables and credentials. */
export type SecretOperation = 'read';

export interface SecretRule {
  readonly operations: readonly (SecretOperation | '*')[];
  /** Variable names: `CURSOR_API_KEY`, `*_TOKEN`, `*`. */
  readonly secrets: readonly string[];
  readonly ignores?: { readonly secrets?: readonly string[] };
}

export interface PolicyGroups {
  readonly filesystem?: readonly FilesystemRule[];
  readonly web?: readonly WebRule[];
  readonly network?: readonly NetworkRule[];
  readonly execution?: readonly ExecutionRule[];
  readonly tools?: readonly ToolRule[];
  readonly agents?: readonly SubagentRule[];
  readonly communication?: readonly CommunicationRule[];
  readonly secrets?: readonly SecretRule[];
}

export type PolicyCategory = keyof PolicyGroups;

/**
 * What an agent may do. For each action the most restrictive matching rule
 * wins (deny > requireApproval > allow); with none, `default`.
 */
export interface AgentPolicy {
  readonly default: ActionPolicy;
  readonly allow?: PolicyGroups;
  readonly requireApproval?: PolicyGroups;
  readonly deny?: PolicyGroups;
}

/** One thing an agent is about to do, as a policy checks it. */
export type AgentAction =
  | {
      readonly category: 'filesystem';
      readonly operation: FilesystemOperation;
      readonly path: string;
    }
  | {
      readonly category: 'web';
      readonly operation: WebOperation;
      readonly domain: string;
    }
  | {
      readonly category: 'network';
      readonly operation: NetworkOperation;
      readonly host: string;
    }
  | { readonly category: 'execution'; readonly command: string }
  | {
      readonly category: 'tools';
      readonly operation: ToolOperation;
      readonly tool: string;
    }
  | {
      readonly category: 'agents';
      readonly operation: SubagentOperation;
      readonly agent: string;
    }
  | {
      readonly category: 'communication';
      readonly operation: CommunicationOperation;
      readonly channel: string;
    }
  | {
      readonly category: 'secrets';
      readonly operation: SecretOperation;
      readonly secret: string;
    };

/** Any rule, of any category. */
export type PolicyRule =
  | FilesystemRule
  | WebRule
  | NetworkRule
  | ExecutionRule
  | ToolRule
  | SubagentRule
  | CommunicationRule
  | SecretRule;

/** What a policy decided for one action, and why. */
export interface PolicyDecision {
  readonly policy: ActionPolicy;
  /** `approved`: a pattern approved while running (see `checkCommand`). */
  readonly source:
    'allow' | 'deny' | 'requireApproval' | 'default' | 'approved';
  readonly rule?: PolicyRule;
  readonly reason: string;
}

/** A decision on a whole command line (`checkCommand`). */
export interface CommandPolicyDecision extends PolicyDecision {
  /** The simple command whose decision won; absent for an empty line. */
  readonly part?: string;
  /**
   * Redirection, substitution, heredoc or script: an allowed line still
   * needs approval, since no rule can read its effect.
   */
  readonly complex: boolean;
}

export interface ApprovalRequest {
  readonly action: AgentAction;
  readonly decision: PolicyDecision;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>;

/** A path the sandbox shows read-only or hides. */
export interface FilesystemMask {
  readonly path: string;
  readonly access: 'readonly' | 'hidden';
}

/** `filesystem` as the sandbox enforces it. */
export interface FilesystemAccess {
  readonly workspaceAccess: 'readonly' | 'readwrite';
  /** Folders writable over a read-only workspace (`write /workspace/guides/**`). */
  readonly writable: readonly string[];
  readonly masks: readonly FilesystemMask[];
}
