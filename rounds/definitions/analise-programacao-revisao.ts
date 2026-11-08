/**
 * Three local agents (Ollama) from start to end, without asking anything:
 * the programmer consults the analyst, fixes what it pointed out and
 * consults the reviewer. Every run starts from the `analise-base` fixture
 * (a small JavaScript project whose tests run with `node --test`, nothing to
 * install) in its own folder (rounds.dir), and the git says what each agent
 * really changed.
 */
import {
  OllamaProvider,
  type AgentPolicy,
  type WorkspaceOptions,
} from '../../src/index';
import {
  defineRound,
  noQuestions,
  noToolCallAsText,
  readOnlyRespected,
  roundDir,
} from '../../src/rounds/index';

const id = 'analise-programacao-revisao';

/** The round's own folder, in rounds.dir: recreated from the fixture on every run. */
const root = roundDir(id);

/**
 * Every agent in its own sandbox, with nothing of the host's CLI state.
 * Bubblewrap, not Docker: the tests run with the host's `node`.
 */
const workspace: WorkspaceOptions = {
  type: 'bubblewrap',
  root,
  hostState: 'none',
};

/**
 * The model every agent runs on: it must call the CLI's tools for real.
 * qwen3.5:4b is the one that did, in the ollama-product-owner rounds.
 */
const local = (): OllamaProvider =>
  new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' });

/**
 * Commands that only look or run the tests. A bare command (`ls`,
 * `git diff`) is its own pattern: `ls *` needs something after it.
 */
const LOOK_AND_TEST = [
  'ls',
  'ls *',
  'cat *',
  'find *',
  'pwd',
  'git status',
  'git diff',
  'git diff *',
  'git log *',
  'npm test',
  'npm start',
  'node --test',
  'node --test *',
];

/**
 * The analyst and the reviewer: read the project and run what only looks;
 * anything else is denied without asking (nobody answers in a round). The
 * sandbox enforces it. Any policy also gives the agent its network
 * boundary, which is what reads Ollama's traffic: without one, the tokens
 * are not measured.
 */
const READ_ONLY: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
    execution: [{ commands: LOOK_AND_TEST }],
  },
};

/**
 * The programmer: READ_ONLY plus writing to the whole workspace. Files are
 * written with the CLI's file tool, which only this filesystem rule
 * governs; a shell redirect (`cat > a.js`) is never allowed by a pattern.
 */
const WRITE_WORKSPACE: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read', 'write'], paths: ['/workspace/**'] }],
    execution: [{ commands: LOOK_AND_TEST }],
  },
};

/** For whoever must not change files: running the tests changes nothing. */
const RUN_IN_PLACE =
  'Você pode rodar os testes (npm test) e o programa (npm start) no próprio diretório. Não copie o projeto para outro lugar.';

/** What every fix must have, in the rounds being compared. */
const EVERY_FIX_TESTED =
  'Todo ponto corrigido ganha um teste que falharia sem a correção.';

/** How the programmer writes: the shell redirect is blocked by the policy. */
const EDIT_WITH_TOOL =
  'Para criar ou alterar arquivos, use a ferramenta de editar arquivos, não comandos de shell com > ou <<: eles são bloqueados.';

const NO_QUESTIONS =
  'Não faça perguntas: ninguém vai responder. Quando houver uma decisão, escolha a opção mais simples e diga qual escolheu.';

const TEAM = 'uma equipe de três agentes: analista, programador e revisor.';

export default defineRound({
  id,
  goal: 'Cada papel faz só a sua parte, e toda correção tem um teste que falha sem ela.',
  start: { fixture: 'analise-base' },
  actors: {
    analista: {
      provider: local(),
      workspace,
      policy: READ_ONLY,
      readOnly: true,
    },
    programador: {
      provider: local(),
      workspace,
      policy: WRITE_WORKSPACE,
    },
    revisor: {
      provider: local(),
      workspace,
      policy: READ_ONLY,
      readOnly: true,
    },
  },
  flow: [
    {
      actor: 'analista',
      by: 'programador',
      prompt: () => [
        `Você é o analista de ${TEAM}`,
        'O programador pediu esta análise.',
        'Analise o projeto do diretório atual: leia src/ e o README.md, e compare o que cada função promete com o que ela faz.',
        'Não altere nenhum arquivo do projeto.',
        NO_QUESTIONS,
        RUN_IN_PLACE,
        'Responda só com a lista de problemas, do mais importante para o menos importante, cada um com o arquivo e a linha (src/usuarios.js:12).',
      ],
    },
    {
      actor: 'programador',
      prompt: ({ said }) => [
        `Você é o programador de ${TEAM}`,
        'O analista entregou a análise abaixo.',
        'Corrija os problemas que valem a pena corrigir.',
        EVERY_FIX_TESTED,
        EDIT_WITH_TOOL,
        NO_QUESTIONS,
        'Não faça commits.',
        'No fim, rode npm test e diga o que mudou, arquivo por arquivo, qual teste cobre cada correção, e o que deixou de fora e por quê.',
        '',
        'Análise do analista:',
        said['analista'] ?? '',
      ],
    },
    {
      actor: 'revisor',
      by: 'programador',
      prompt: ({ said }) => [
        `Você é o revisor de ${TEAM}`,
        'O programador fez as mudanças abaixo, a partir da análise do analista.',
        'Confira no código (git diff) se as mudanças estão certas e completas.',
        `Regra da equipe: ${EVERY_FIX_TESTED} Confira, ponto por ponto, se cada correção tem esse teste.`,
        'Não altere nenhum arquivo do projeto.',
        NO_QUESTIONS,
        RUN_IN_PLACE,
        'Responda com o que está certo, o que está errado e o que falta, do mais importante para o menos importante.',
        '',
        'Análise do analista:',
        said['analista'] ?? '',
        '',
        'O que o programador diz que mudou:',
        said['programador'] ?? '',
      ],
    },
  ],
  // What the prompts ask, checked in the workspace at the end of each step.
  criteria: {
    // "Não altere nenhum arquivo do projeto."
    analista: [{ file: { name: '*', changed: false } }],
    revisor: [{ file: { name: '*', changed: false } }],
  },
  rules: [readOnlyRespected(), noQuestions(), noToolCallAsText()],
});
