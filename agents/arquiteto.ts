import {
  Agent,
  CodexProvider,
  runScript,
  Workspace,
} from '../src/index.js';

await runScript(async () => {
  const arquiteto = new Agent({
    prompt: `vamos bater um papo`.trim(),
    provider: new CodexProvider({
      model: 'gpt-6.1-sol',
    }),
    workspace: new Workspace({
      type: 'unrestricted',
      // image: 'from choliba-agent:latest',
      root: process.env?.workpace ?? process.cwd(),
    }),
  });

  await arquiteto.run();
});
