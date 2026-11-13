import { FETCH_WEB_CONTENT } from '../../agents/tools/fetch-web-content';
import { OllamaProvider } from '../../src/index';
import type { AgentPolicy } from '../../src/policy/policy.interface';
import {
  defineRound,
  noQuestions,
  noToolCallAsText,
  roundDir,
  type RoundActor,
} from '../../src/rounds/index';

const id = 'google-search';
const root = roundDir(id);

/**
 * The search page as plain HTML: the project's tool reads headings and
 * links, and DuckDuckGo's HTML version gives them without JavaScript or a
 * consent screen. Claude Code's own WebSearch runs on Anthropic's servers,
 * which a local model behind Ollama does not have. The term goes in as
 * typed: the tool's browser encodes the address.
 */
const SEARCH_URL = 'https://html.duckduckgo.com/html/?q=';

/** What every prompt ends with. */
const DONT_DO_IT: readonly string[] = [
  '**NÃO ESCREVA NO TERMINAL O QUE VOCE FEZ. NUNCA!!!**',
  '*** Não USE WebSearch, WebFetch ***',
  'Não faça perguntas: ninguém vai responder',
];

/**
 * The policy both agents share: files in the round's folder, the project's
 * tool, and the network open except for the model clouds (denied quietly,
 * never queued for an approval nobody gives in a round).
 */
const POLICY: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
    // The page is opened by the tool, in the Goiaba's process.
    tools: [{ operations: ['call'], tools: [FETCH_WEB_CONTENT] }],
    network: [{ operations: ['*'], hosts: ['*'] }],
  },
  deny: {
    network: [
      {
        operations: ['*'],
        hosts: [
          'openai.com',
          '*.openai.com',
          'chatgpt.com',
          '*.chatgpt.com',
          'anthropic.com',
          '*.anthropic.com',
        ],
      },
    ],
  },
};

/**
 * Every agent this file knows, declared once and picked by name below. To
 * try another model, change it here (or add an agent with another name):
 *
 *   provider: new ClaudeProvider({ model: 'claude-haiku-5-5', tools: [...] }),
 *   provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b', tools: [FETCH_WEB_CONTENT] }),
 *
 * With Claude Code (`cli: 'claude'`), `tools` is everything the model sees:
 * without file_read and file_write it reads and writes no file. With Codex,
 * `tools` takes only the project's: Codex always has its own.
 */
const ACTORS = {
  'google-search': {
    provider: new OllamaProvider({
      cli: 'claude',
      model: 'qwen3.5:4b',
      tools: ['file_read', 'file_write', FETCH_WEB_CONTENT],
    }),
    workspace: { type: 'bubblewrap', root, hostState: 'none' },
    policy: POLICY,
  },
  'data-driven-profiler': {
    provider: new OllamaProvider({
      cli: 'claude',
      model: 'qwen3.5:4b',
      tools: ['file_read', 'file_write', FETCH_WEB_CONTENT],
    }),
    workspace: { type: 'bubblewrap', root, hostState: 'none' },
    policy: POLICY,
  },
} satisfies Readonly<Record<string, RoundActor>>;

type ActorName = keyof typeof ACTORS;

/** The agents of the round, by name, out of `ACTORS`. */
export const getActors = (
  ...names: readonly ActorName[]
): Record<string, RoundActor> =>
  Object.fromEntries(names.map((name) => [name, ACTORS[name]]));

export default defineRound({
  // Who is searched is asked when the round starts: the file keeps only the
  // question, and the term reaches the prompts and the criteria.
  inputs: { termo: 'Quem você quer pesquisar?' },
  repeat: 1,
  id,
  goal: 'Um modelo local consegue buscar um termo na web com a ferramenta do projeto e guardar o resultado?',
  start: { fixture: 'google-search' },
  actors: getActors('google-search', 'data-driven-profiler'),
  flow: [
    {
      actor: 'google-search',
      prompt: ({ inputs }) => [
        `Pesquise "${inputs['termo'] ?? ''}" na web.`,
        `Use fetch_web_content ${SEARCH_URL}${inputs['termo'] ?? ''}`,
        `Crie o arquivo pesquisa.txt com a primeira linha "termo: ${inputs['termo'] ?? ''}" e, abaixo, os resultados, um por linha, com o título e o link.`,
        `Para cada achado, escreva um resumo rápido sobre ${inputs['termo'] ?? ''}.`,
        ...DONT_DO_IT,
      ],
    },
    {
      actor: 'data-driven-profiler',
      prompt: ({ said }) => [
        'Análise do analista:',
        said['google-search'] ?? '',
        '**ANALISE COM ATENÇÃO O ARQUIVO pesquisa.txt**',
        'Crie o arquivo perfil.md com este modelo:',
        `Nome: <>
        Área profissional: <>
        Tempo de experiência: <>
        Localização: <>
        Presença online: <>
        Idade aproximada: <>
        Ocupação atual: <>`,
        '',
        'Use fetch_web_content para abrir os links que estão em pesquisa.txt e obter mais dados.',
        'Preencha o perfil em perfil.md com o que encontrar.',
        ...DONT_DO_IT,
      ],
    },
  ],
  criteria: {
    'google-search': [
      {
        if: { name: 'pesquisa.txt', exists: false },
        check: [
          {
            file: {
              name: 'pesquisa.txt',
              created: true,
              contains: ['termo: {{input:termo}}'],
            },
          },
        ],
      },
      { limit: { time: '2min', tokens: 10000 } },
    ],
    'data-driven-profiler': [
      {
        file: {
          name: 'perfil.md',
          created: true,
          contains: ['{{input:termo}}'],
        },
      },
      { limit: { time: '2min', tokens: 10000 } },
    ],
  },
  rules: [noQuestions(), noToolCallAsText()],
});
