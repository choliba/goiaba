import { homedir } from 'node:os';

import {
  Agent,
  ClaudeProvider,
  ensureDirectory,
  humanApprover,
  runScript,
  StandardOutput,
  Workspace,
  type OutputAdapter,
  join,
} from '../src/index';
import { centerListener } from './center.listener';
import { todasAsPermissoes } from './permissions';

/**
 * The app agent on a local Ollama model through the Claude CLI, with every
 * way in and out of it spelled out.
 *
 * In:
 *   1. `prompt`           the task, sent on the first turn
 *   2. `interaction.ask`  your answer when the agent asks something
 *   3. `interaction.listen` what you type while it works (Ctrl+A: approvals)
 *   4. `interaction.choose` one-key choices (approval prompts)
 *   5. `approve`          decides commands the policy leaves open
 *   6. `signal`           stops the agent (Ctrl+C aborts the script's signal)
 *
 * Out:
 *   1. `interaction.write` what the agent shows on screen, as text
 *   2. `subscribe`         everything reported while it runs (listener1, 2)
 *   3. logs and database   `logDir` and `database` in goiaba.config.ts
 */
// The terminal: the only reader of stdin and writer of stdout.
const terminal = new StandardOutput();

await runScript(async ({ signal }) => {
  const root = process.env['workspace'] ?? '/';
  ensureDirectory(root);

  // In 2–4 and out 1. Each method can be replaced (e.g. a web chat); here
  // each one goes to the terminal.
  const interaction: OutputAdapter = {
    ask: (question, abort, instant) => terminal.ask(question, abort, instant),
    listen: (abort) => terminal.listen(abort),
    choose: (keys, abort) => terminal.choose(keys, abort),
    write: (text) => terminal.write(text),
    width: () => terminal.width(),
    close: () => terminal.close(),
  };

  await new Agent({
    name: 'claude-haiku-5-5',
    prompt: 'vamos conversar',
    provider: new ClaudeProvider({ model: 'claude-haiku-5-5' }),
    workspace: new Workspace({
      type: 'docker',
      image: 'choliba-agent:latest',
      root,
      // Package manager caches, so bun/npm install work inside the sandbox.
      writable: [
        join(homedir(), '.bun/install/cache'),
        join(homedir(), '.npm'),
      ],
    }),
    permissions: todasAsPermissoes,
    interaction,
    // Out 2: one or more functions that receive everything.
    subscribe: [centerListener],
    // In 5: the default, asking you in the terminal ([u/s/w/n]).
    approve: humanApprover(interaction, signal),
    // In 6.
    signal,
    // Waits for your next message after every answer; Ctrl+C ends it.
    conversation: true,
  }).run();
});
