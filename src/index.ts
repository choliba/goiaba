export { AGENT_SHORTCUTS, Agent, agentConversation } from './agent/agent';
export { AgentOutput } from './agent/output';
export { humanApprover } from './approval/human';
export type { CommandApprover, CommandApprovalRequest } from './approval/gate';
export type { ApprovalScope } from './store/index';
export {
  dirname,
  ensureDirectory,
  isAbsolute,
  join,
  pathExists,
  readText,
  relative,
  resolve,
} from './filesystem/index';
export {
  clearConfigCache,
  defineConfig,
  getConfig,
  getEnv,
  isConfigLoaded,
  loadConfig,
} from './config/index';
export type {
  GoiabaConfig,
  GoiabaDatabaseConfig,
  GoiabaConfigFactory,
  GoiabaEnv,
  LoadConfigOptions,
  ResolvedGoiabaConfig,
  ResolvedGoiabaEnv,
} from './config/index';
import { loadConfig } from './config/index';
import { showUncaughtErrors } from './usage';

export {
  runScript,
  UsageError,
  type RunScriptOptions,
  type ScriptContext,
} from './usage';
export type {
  AgentAsk,
  AgentOptions,
  AgentProvider,
  AgentStatus,
  AgentSubscriber,
} from './agent/types';
export {
  Executor,
  OutputDispatcher,
  OutputStream,
  ProgramExecutionError,
} from './execute/index';
export type {
  ExecutorOptions,
  OutputEvent,
  RunOptions,
  SpawnProcess,
} from './execute/index';
export type { ProgramCommand, ProgramOutput } from './execute/types';
export { PolicyEngine, wildmatch } from './policy/index';
export type {
  ActionPolicy,
  AgentAction,
  AgentPolicy,
  ApprovalHandler,
  ApprovalRequest,
  CommunicationOperation,
  CommunicationRule,
  ExecutionRule,
  FilesystemOperation,
  FilesystemRule,
  NetworkOperation,
  NetworkRule,
  PolicyCategory,
  PolicyDecision,
  PolicyGroups,
  PolicyRule,
  SecretOperation,
  SecretRule,
  SubagentOperation,
  SubagentRule,
  ToolOperation,
  ToolRule,
  WebOperation,
  WebRule,
} from './policy/index';
export {
  Conversation,
  DEFAULT_MAX_UNANSWERED_REQUESTS,
} from './interaction/index';
export type {
  ConversationOptions,
  InputEvent,
  Interaction,
  InteractionAdapter,
  InteractionRequest,
  PendingRequest,
} from './interaction/index';
export { StdioAdapter } from './adapters/stdio/index';
export type { StdioAdapterOptions, StdioSource } from './adapters/stdio/index';
export { DEFAULT_MAX_RECORD_BYTES } from './adapters/constants';
export { TuiInteraction, ttyScreen } from './tui/index';
export type {
  TuiInput,
  TuiInputHandlers,
  TuiOptions,
  TuiScreen,
} from './tui/index';
export {
  completeOutput,
  DEFAULT_LINE_LENGTH,
  stdioOutput,
} from './output/index';
export type { Output, PartialOutput } from './output/index';
export type { GoiabaEvent } from './events/index';
export type {
  AgentEvent,
  Provider,
  ProviderEvent,
  ProviderOptions,
  TokenUsage,
  ToolEvent,
} from './providers/types';
export { Workspace } from './workspace/index';
export type { WorkspaceOptions, WorkspaceType } from './workspace/index';
export {
  BubblewrapSandbox,
  bubblewrapEnterCommand,
  DEFAULT_DOCKER_IMAGE,
  DockerSandbox,
  type Sandbox,
} from './workspace/sandbox/index';
export { CodexProvider } from './providers/codex/codex-provider';
export { CursorProvider } from './providers/cursor-provider';
export {
  OllamaProvider,
  type OllamaCli,
  type OllamaProviderOptions,
} from './providers/ollama-provider';
export {
  ClaudeProvider,
  type ClaudeProviderOptions,
} from './providers/claude/claude-provider';

// Importing Goiaba is enough to run an agent: goiaba.config.ts (log,
// database, envs) is loaded here, so `process.env` already has its values at
// the top of an agent file, and uncaught usage errors show as messages.
// `runScript` stays for a script that wants its own config or one log for
// several agents.
showUncaughtErrors();
await loadConfig();
