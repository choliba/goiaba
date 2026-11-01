import {
  AGENT_TERMINAL,
  Agent,
  ClaudeProvider,
  CodexProvider,
  ensureDirectory,
  humanApprover,
  join,
  runScript,
  TerminalInteraction,
  UsageError,
  Workspace,
} from '../src/index';
import { currentDirectory, programArguments } from '../src/execute/process';
import { NetworkBoundary, networkRulesOf } from '../src/network/index';
import { todasAsPermissoes } from './permissions';

/**
 * Two agents to compare, each on its own CLI and model, in the cloud (your
 * Anthropic and OpenAI logins): `claude` on Claude and `codex` on Codex.
 * Each works on its own folder (storage/workspaces/agente-<cli>) inside
 * bubblewrap and talks to you in the terminal. They can run at once, in two
 * terminals:
 *
 *   bun agents/cloud.compare.ts claude
 *   bun agents/cloud.compare.ts codex
 *
 * Ctrl+A opens the approvals; Ctrl+C ends it.
 */
type Cli = 'claude' | 'codex';

const terminal = new TerminalInteraction(AGENT_TERMINAL);

/** The provider of each agent. */
function providerOf(cli: Cli): ClaudeProvider | CodexProvider {
  return cli === 'claude'
    ? new ClaudeProvider({ model: 'claude-haiku-5-5' })
    : new CodexProvider({ model: 'gpt-6-luna' });
}

/**
 * The workspace, with the network built here instead of by the agent. Each
 * agent has its own folder, so both can run at once (one agent per folder).
 */
function workspaceFor(
  cli: Cli,
  provider: ClaudeProvider | CodexProvider,
): Workspace {
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
      // 1. Always allowed: the model's API (Anthropic's or OpenAI's).
      alwaysAllow: provider.networkEndpoints(),
      // 2. The policy's network rules (allow, deny, requireApproval, default).
      rules: networkRulesOf(todasAsPermissoes),
      // 3. What the rules leave open: asks you in the terminal.
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
function chosenCli(): Cli {
  const cli = programArguments().at(0);
  if (cli === 'claude' || cli === 'codex') return cli;
  throw new UsageError(
    `Agente desconhecido: ${cli ?? '(nenhum)'}. Use: bun agents/cloud.compare.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const provider = providerOf(cli);

  await new Agent({
    resume: false,
    name: `agente-${cli}`,
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
