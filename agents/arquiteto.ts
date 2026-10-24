import { Agent, CursorProvider, Workspace } from '../src/index.js';

// const codex = new CursorProvider({
//   model: 'Auto',
// });

// const workspace = new Workspace({
//   type: 'unrestricted',
//   root: '/home/dev/dev/sandbox-teste',
// });

const arquiteto = new Agent({
  prompt: `Me peça instruções`.trim(),
  provider: new CursorProvider({
    model: 'Auto',
  }),
  workspace: new Workspace({
    type: 'unrestricted',
    root: '/home/dev/dev/sandbox-teste',
  })
});

await arquiteto.run();
