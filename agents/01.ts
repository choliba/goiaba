import {
  Agent,
  ClaudeProvider,
  // CodexProvider,
  // CursorProvider,
  // CodexProvider,
  // ClaudeProvider,
  getConfig,
  // OllamaProvider,
  runScript,
  Workspace,
} from '../src/index';

await runScript(async () => {
  await new Agent({
    name: 'analista',
    prompt: 'Analise o projeto.',
    // provider: new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' }),
    provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
    // provider: new CodexProvider({ model: 'gpt-5.6-terra' }),
    // provider: new CursorProvider({ model: 'gpt-5.6-terra' }),
    workspace: new Workspace({
      type: 'docker',
      image: 'FROM busybox:latest',
      root: getConfig().workspaces.dir,
      hostState: 'none',
    }),
  }).run();
});
