import { Agent, CursorProvider, Workspace } from '../src/index.js';

const arquiteto = new Agent({
  prompt: `Vamos apenas bater um papo?`.trim(),
  provider: new CursorProvider({
    model: 'Auto',
  }),
  workspace: new Workspace({
    type: 'unrestricted',
    root: '/home/dev/dev/sandbox-teste',
  }),
});

await arquiteto.run();
