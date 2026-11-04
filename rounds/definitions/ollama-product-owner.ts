/**
 * Two local agents (Ollama), from start to end, without asking anything: the
 * product owner writes the task for a footer and hands it to the analyst,
 * who reads the project and defines how it will be built. Neither changes a
 * file; every run starts from the workspace's `rodada-base` tag, and the git
 * checks it.
 */
import {
  getConfig,
  OllamaProvider,
  type WorkspaceOptions,
} from '../../src/index';
import {
  defineRound,
  noQuestions,
  readOnlyRespected,
} from '../../src/rounds/index';

const root = getConfig().workspaces.dir;

/** Every agent in its own sandbox, with nothing of the host's CLI state. */
const workspace: WorkspaceOptions = {
  type: 'docker',
  image: 'FROM busybox:latest',
  root,
  hostState: 'none',
};

/**
 * The model both agents run on. It must call the CLI's tools for real:
 * qwen2.5-coder writes the call as text (`{"name": "write_stdin", …}`), and
 * then nothing runs.
 */
const local = (): OllamaProvider =>
  new OllamaProvider({ cli: 'codex', model: 'qwen2.5-coder:latest' });

const TEAM = 'uma equipe de dois agentes: product owner e analista.';

const NO_CHANGES =
  'Não altere nenhum arquivo do projeto e não faça perguntas: ninguém vai responder. Quando houver uma decisão, escolha a opção mais simples e diga qual escolheu.';

export default defineRound({
  id: 'ollama-product-owner',
  goal: 'O product owner escreve a tarefa do rodapé e o analista define a implementação, sem alterar nenhum arquivo nem fazer perguntas.',
  start: { git: { root, tag: 'rodada-base' } },
  actors: {
    'product-owner': { provider: local(), workspace, readOnly: true },
    analista: { provider: local(), workspace, readOnly: true },
  },
  flow: [
    {
      actor: 'product-owner',
      prompt: () => [
        `Você é o product owner de ${TEAM}`,
        'Escreva a tarefa para implementar um rodapé no projeto do diretório atual.',
        'A definição é que o rodapé não deve ter nenhum conteúdo.',
        NO_CHANGES,
        'Responda só com a tarefa, para o analista: o objetivo, o que está dentro e fora do escopo e como saber que está pronta.',
      ],
    },
    {
      actor: 'analista',
      by: 'product-owner',
      prompt: ({ said }) => [
        `Você é o analista de ${TEAM}`,
        'O product owner entregou a tarefa abaixo.',
        'Leia o projeto do diretório atual e defina como a tarefa será implementada.',
        NO_CHANGES,
        'Responda com o plano: os arquivos que mudam e o que muda em cada um, e os testes que confirmam que a tarefa está pronta.',
        '',
        'Tarefa do product owner:',
        said['product-owner'] ?? '',
      ],
    },
  ],
  rules: [readOnlyRespected(), noQuestions()],
});
