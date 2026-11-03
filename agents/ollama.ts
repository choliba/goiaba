import {
  agentConversation,
  Agent,
  ensureDirectory,
  humanApprover,
  join,
  OllamaProvider,
  runScript,
  UsageError,
  Workspace,
  type OllamaCli,
} from '../src/index';
import { currentDirectory, programArguments } from '../src/execute/process';
import { NetworkBoundary, networkRulesOf } from '../src/network/index';
import { todasAsPermissoes } from './permissions';

/**
 * Two agents to compare on the same local Ollama model, one per CLI:
 * `claude` through Claude Code and `codex` through Codex. Each works on its
 * own folder (storage/workspaces/agente-ollama-<cli>) inside bubblewrap and
 * talks to you in the terminal. They can run at once, in two terminals:
 *
 *   bun agents/ollama.ts claude
 *   bun agents/ollama.ts codex
 *
 * Ctrl+A opens the approvals; Ctrl+C ends it.
 */
const MODEL = 'qwen3.5:4b-64k';
// const MODEL = 'tech-stack-analyzer:latest';
// const MODEL = 'qwen3.5:4b';

const terminal = agentConversation();

/** The provider of each agent: the same model, only the CLI changes. */
function providerOf(cli: OllamaCli): OllamaProvider {
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
    `agente-ollama-${cli}`,
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
    `Agente desconhecido: ${cli ?? '(nenhum)'}. Use: bun agents/ollama.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const provider = providerOf(cli);

  await new Agent({
    resume: false,
    name: `agente-ollama-${cli}`,
    prompt:
      'já inicie a conversa gerendo um texto de 5 linhas DE 20 CARACTERES **SEM MANDAR NADA PARA O TERMINAL** sobre qualquer assunto, e depois aguarde instruções. **NÃO** use o terminal para escrever nada, apenas gere o texto e aguarde.',
    provider,
    workspace: workspaceFor(cli, provider),
    permissions: todasAsPermissoes,
    interaction: terminal,
    approve: humanApprover(terminal, signal),
    signal,
    conversation: true,
  }).run();
});
