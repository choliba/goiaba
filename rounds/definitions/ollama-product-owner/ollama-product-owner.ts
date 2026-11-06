/**
 * One local agent (Ollama), from start to end, without asking or saying
 * anything: it writes a file and exits. Every run starts from the
 * `site-vazio` fixture in its own folder (rounds.dir), and the git says
 * what it changed.
 */
import {
  OllamaProvider,
  type AgentPolicy,
  type WorkspaceOptions,
} from '../../../src/index';
import {
  defineRound,
  noQuestions,
  roundDir,
  // noToolCallAsText,
} from '../../../src/rounds/index';

const id = 'ollama-product-owner';

/** The round's own folder, in rounds.dir: recreated from the fixture on every run. */
const root = roundDir(id);

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
        paths: [`/workspace/**`],
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
  id,
  goal: 'O agente escreve um arquivo e sai, sem perguntar nem falar nada.',
  start: { fixture: 'site-vazio' },
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
  // What the prompt asks, checked in the workspace at the end of the step:
  // without it, the effectiveness does not see that no file was written.
  instructions: {
    'product-owner': [
      {
        // "Se ele existir, alterar o fundo do body": index.html was there
        // when the agent started.
        when: { file: 'index.html' },
        check: { file: 'index.html', contains: 'background' },
        // "Apenas crie um index.html": it was not (the site-vazio fixture
        // has none), so it must be there at the end.
        otherwise: { file: 'index.html' },
      },
    ],
  },
  // readOnlyRespected left out: the only agent is meant to write.
  rules: [noQuestions()],
});
