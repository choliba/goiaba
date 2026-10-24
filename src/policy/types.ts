export type ActionPolicy = 'allow' | 'deny' | 'require_approval';

export type FilesystemOperation = 'read' | 'write';
export type WebOperation = 'search' | 'read_text' | 'interact' | 'form_submit' | 'login' | 'browse';
export type CommunicationOperation = 'send_email' | 'post_social_media' | 'send_logs';

export interface FilesystemRule {
  readonly operations: readonly (FilesystemOperation | '*')[];
  readonly paths: readonly string[];
  readonly ignores?: { readonly paths?: readonly string[] };
}

export interface WebRule {
  readonly operations: readonly (WebOperation | '*')[];
  readonly domains: readonly string[];
  readonly ignores?: { readonly domains?: readonly string[] };
}

/** Execution is governed by command only: no CLI can verify intent (tests, lint...). */
export interface ExecutionRule {
  readonly commands: readonly string[];
  readonly ignores?: { readonly commands?: readonly string[] };
}

export interface CommunicationRule {
  readonly operations: readonly (CommunicationOperation | '*')[];
  readonly channels: readonly string[];
  readonly ignores?: { readonly channels?: readonly string[] };
}

export interface PermissionGroups {
  readonly filesystem?: readonly FilesystemRule[];
  readonly web?: readonly WebRule[];
  readonly execution?: readonly ExecutionRule[];
  readonly communication?: readonly CommunicationRule[];
}

export interface AgentPermissions {
  readonly default: ActionPolicy;
  readonly allow?: PermissionGroups;
  readonly deny?: PermissionGroups;
  readonly requireApproval?: PermissionGroups;
}

export type PolicyAction =
  | { readonly category: 'filesystem'; readonly operation: FilesystemOperation; readonly path: string }
  | { readonly category: 'web'; readonly operation: WebOperation; readonly domain: string }
  | { readonly category: 'execution'; readonly command: string }
  | { readonly category: 'communication'; readonly operation: CommunicationOperation; readonly channel: string };

export interface PolicyDecision {
  readonly policy: ActionPolicy;
  readonly source: 'allow' | 'deny' | 'requireApproval' | 'default';
  readonly rule?: FilesystemRule | WebRule | ExecutionRule | CommunicationRule;
  readonly reason: string;
}

export interface ApprovalRequest {
  readonly action: PolicyAction;
  readonly decision: PolicyDecision;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>;

export interface FilesystemMask {
  readonly path: string;
  readonly access: 'readonly' | 'hidden';
}

export interface FilesystemAccess {
  readonly workspaceAccess: 'readonly' | 'readwrite';
  readonly masks: readonly FilesystemMask[];
}
