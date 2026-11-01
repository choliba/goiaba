import {
  AGENT_TERMINAL,
  Agent,
  ensureDirectory,
  humanApprover,
  join,
  OllamaProvider,
  runScript,
  TerminalInteraction,
  UsageError,
  Workspace,
  type OllamaCli,
} from '../src/index';
import { currentDirectory, programArguments } from '../src/execute/process';
import { NetworkBoundary, networkRulesOf } from '../src/network/index';
import { todasAsPermissoes } from './permissions';

/**
 * Two agents on the same local Ollama model, one per CLI, to compare them.
 * Each works on its own folder (storage/workspaces/agente-<cli>) inside
 * bubblewrap and talks to you in the terminal. They can run at once, in two
 * terminals:
 *
 *   bun agents/ollama.claude.ts claude
 *   bun agents/ollama.claude.ts codex
 *
 * Ctrl+A opens the approvals; Ctrl+C ends it.
 */
const MODEL = 'qwen3.5:4b';

const terminal = new TerminalInteraction(AGENT_TERMINAL);

/** The provider of each agent. */
function providerOf(cli: OllamaCli): OllamaProvider {
  if (cli === 'claude') {
    // Only these tools: the full set is ~15k tokens on every request.
    return new OllamaProvider({
      cli,
      model: MODEL,
      tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
    });
  }
  return new OllamaProvider({ cli, model: MODEL });
}

/**
 * The workspace, with the network built here instead of by the agent. Each
 * agent has its own folder, so both can run at once (one agent per folder).
 */
function workspaceFor(cli: OllamaCli, provider: OllamaProvider): Workspace {
  const root = join(
    currentDirectory(),
    'storage',
    'workspaces',
    `agente-${cli}`,
  );
  ensureDirectory(root);
  const workspace = new Workspace({ type: 'bubblewrap', root });
  // Every connection leaving the sandbox passes through it, in this order:
  workspace.configureNetwork(
    new NetworkBoundary({
      // 1. Always allowed: the model's API (Ollama, localhost:11434).
      alwaysAllow: provider.networkEndpoints(),
      // 2. Always denied: the CLI's own cloud, useless with a local model.
      alwaysDeny: provider.networkBlocked(),
      // 3. The policy's network rules (allow, deny, requireApproval, default).
      rules: networkRulesOf(todasAsPermissoes),
      // 4. What the rules leave open: asks you in the terminal.
      approve: ({ hostname, port, pattern, reason }) =>
        humanApprover(terminal)({
          command: `${hostname}:${String(port)}`,
          pattern,
          reason,
          provider: provider.id,
          category: 'network',
        }),
    }),
  );
  return workspace;
}

/** Which agent to run: the first argument. */
function chosenCli(): OllamaCli {
  const cli = programArguments().at(0);
  if (cli === 'claude' || cli === 'codex') return cli;
  throw new UsageError(
    `Agente desconhecido: ${cli ?? '(nenhum)'}. Use: bun agents/ollama.claude.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const provider = providerOf(cli);

  await new Agent({
    name: `agente-${cli}`,
    prompt: 'tudo bem?',
    provider,
    workspace: workspaceFor(cli, provider),
    permissions: todasAsPermissoes,
    interaction: terminal,
    approve: humanApprover(terminal, signal),
    signal,
    conversation: true,
  }).run();
});
