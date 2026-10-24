import type { Executor } from '../execute/index.js';
import type { OutputDispatcher } from '../output/index.js';
import type { OutputAdapter } from '../output/index.js';
import type { Provider, ProviderEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';
import type { AgentPermissions } from '../policy/index.js';

export type AgentProvider = Provider<string, string>;

export type AgentAsk = (question: string) => Promise<string>;

export interface AgentOptions {
  readonly prompt: string;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  readonly executor?: Executor;
  readonly output?: OutputDispatcher<ProviderEvent<string>>;
  readonly interaction?: OutputAdapter;
  readonly permissions?: AgentPermissions;
}
