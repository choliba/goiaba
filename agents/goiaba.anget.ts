import {
  getConfig,
  Agent,
  type AgentOutput,
  ensureDirectory,
  OllamaProvider,
  Workspace,
} from '../src/index';

import { todasAsPermissoes } from './permissions';

const root = getConfig().workspaces.dir;
ensureDirectory(root);
const agenteGoiaba = new Agent({
  name: 'dev',
  prompt: 'vamos conversar',
  provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
  permissions: todasAsPermissoes,
  subscribe: [listener],
  workspace: new Workspace({ type: 'bubblewrap', root }),
});

await agenteGoiaba.run();

// await agenteGoiaba.run();

export function listener(output: AgentOutput): void {
  if (output.type() !== 'thinking') return;
  const { phase, seconds } = output.data();
  if (phase === 'start') console.log('pensando…');
  if (phase === 'tick') console.log(`pensando… ${String(seconds)}s`);
  if (phase === 'end') console.log(`pensou ${String(seconds)}s`);
}
