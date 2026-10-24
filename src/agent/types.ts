import type { Executor } from '../execute/index.js';
import type { OutputDispatcher } from '../output/index.js';
import type { Provider, ProviderEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';

export type AgentProvider = Provider<string, string>;

export type AgentAsk = (question: string) => Promise<string>;

export interface AgentOptions {
  readonly prompt: string;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  readonly ask?: AgentAsk;
  readonly executor?: Executor;
  readonly output?: OutputDispatcher<ProviderEvent<string>>;
}
