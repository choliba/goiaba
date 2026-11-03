import {
  Agent,
  join,
  OllamaProvider,
  runScript,
  Workspace,
} from '../src/index';
import { currentDirectory } from '../src/execute/process';

await runScript(async () => {
  await new Agent({
    name: 'analista',
    prompt: 'Analise o projeto.',
    provider: new OllamaProvider({ cli: 'codex', model: 'llama3.2' }),
    workspace: new Workspace({
      // type: 'docker',
      type: 'bubblewrap',
      // image: 'FROM busybox:latest',
      root: join(currentDirectory(), 'storage', 'workspaces'),
    }),
  }).run();
});
