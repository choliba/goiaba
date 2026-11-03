import {
  AGENT_TERMINAL,
  Agent,
  ensureDirectory,
  humanApprover,
  join,
  OllamaProvider,
  runScript,
  TuiInteraction,
  UsageError,
  Workspace,
  type OllamaCli,
} from '../src/index';
import { currentDirectory, programArguments } from '../src/execute/process';
import { todasAsPermissoes } from './permissions';

/**
 * The local Ollama agent on a full screen (the TUI): the messages on top,
 * the status line and what you type at the bottom. Only the CLI changes:
 *
 *   bun agents/tui.ts claude
 *   bun agents/tui.ts codex
 *
 * /help lists the TUI's commands; Ctrl+A opens the approvals; Ctrl+C ends it.
 */
const MODEL = 'qwen3.5:4b';

/** Which CLI: the first argument. */
function chosenCli(): OllamaCli {
  const cli = programArguments().at(0);
  if (cli === 'claude' || cli === 'codex') return cli;
  throw new UsageError(
    `CLI desconhecida: ${cli ?? '(nenhuma)'}. Use: bun agents/tui.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const root = join(
    currentDirectory(),
    'storage',
    'workspaces',
    `agente-tui-${cli}`,
  );
  ensureDirectory(root);
  const tui = new TuiInteraction(AGENT_TERMINAL);

  await new Agent({
    resume: false,
    name: `agente-tui-${cli}`,
    prompt: 'Diga oi em uma linha e pergunte em que pode ajudar.',
    provider: new OllamaProvider({ cli, model: MODEL }),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    permissions: todasAsPermissoes,
    interaction: tui,
    approve: humanApprover(tui, signal),
    signal,
    conversation: true,
  }).run();
});
