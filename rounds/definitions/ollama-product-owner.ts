/**
 * One local agent (Ollama), from start to end, without asking or saying
 * anything: it writes a file and exits. Every run starts from the
 * workspace's `rodada-base` tag, and the git says what it changed.
 */
import {
  getConfig,
  OllamaProvider,
  type AgentPolicy,
  type WorkspaceOptions,
} from '../../src/index';
import {
  defineRound,
  noQuestions,
  noToolCallAsText,
} from '../../src/rounds/index';

// workspaces.dir has no trailing slash: `dir + 'rodadas'` gave
// `…/workspacesrodadas`, a folder that does not exist.
const root = `${getConfig().workspaces.dir}/rodadas`;

/** Every agent in its own sandbox, with nothing of the host's CLI state. */
const workspace: WorkspaceOptions = {
  type: 'bubblewrap',
  root,
  hostState: 'none',
};

/**
 * The model the agent runs on: it must call the CLI's tools for real.
 * qwen2.5-coder wrote the call as text (`{"name": "exec_command", …}`) and
 * nothing ran; qwen3.5:4b is the one the Ollama examples (agents/) use.
 */
const local = (): OllamaProvider =>
  new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' });

/**
 * What the agent may do: read and write the workspace, and run a few
 * commands that only look; anything else is denied without asking (nobody
 * answers in a round). Any policy also gives the agent its network
 * boundary, which is what reads Ollama's traffic: without one, the tokens
 * are not measured.
 */
const WRITE_WORKSPACE: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        // Inside the sandbox the workspace is `/workspace` (singular), the
        // only root the policy accepts. Writing is granted to the whole
        // tree or to a folder that already exists, never to a lone file
        // (`index.html` is refused).
        paths: ['/workspace/**'],
      },
    ],
    execution: [
      {
        commands: [
          'ls *',
          'cat *',
          'find *',
          'pwd',
          'git status',
          'git diff *',
          'git log *',
        ],
      },
    ],
  },
};

export default defineRound({
  id: 'ollama-product-owner',
  goal: 'O agente escreve um arquivo e sai, sem perguntar nem falar nada.',
  start: { git: { root, tag: 'rodada-base' } },
  actors: {
    // Not readOnly: writing the file is the task.
    'product-owner': {
      provider: local(),
      workspace,
      permissions: WRITE_WORKSPACE,
    },
  },
  flow: [
    {
      actor: 'product-owner',
      prompt: () => [
        'Apenas crie um index.html com qualquer conteudo',
        'Não pergunte e nem fale',
        '**SE ELE EXISSTIR ALRERAR FUNDO DE BODY PARAR [secida voce]***',
      ],
    },
  ],
  // readOnlyRespected left out: the only agent is meant to write.
  rules: [noQuestions(), noToolCallAsText()],
});
