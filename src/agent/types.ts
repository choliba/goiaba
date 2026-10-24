import type { Executor } from '../execute/index.js';
import type { OutputDispatcher } from '../output/index.js';
import type { Provider, ProviderEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';
import type { AgentIO } from './io.js';

export type AgentProvider = Provider<string, string>;

export interface AgentOptions {
  readonly prompt: string;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  readonly io?: AgentIO;
  readonly executor?: Executor;
  readonly output?: OutputDispatcher<ProviderEvent<string>>;
}
