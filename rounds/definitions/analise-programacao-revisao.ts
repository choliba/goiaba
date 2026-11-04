/**
 * Three agents from start to end, without asking anything: the programmer
 * consults the analyst, fixes what it pointed out and consults the reviewer.
 * Every run starts from the workspace's `rodada-base` tag, and the git says
 * what each agent really changed.
 */
import {
  ClaudeProvider,
  CursorProvider,
  getConfig,
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

/** For whoever must not change files: testing in place does not count. */
const RUN_IN_PLACE =
  'Você pode compilar e rodar os testes no próprio diretório: o que eles geram (como dist/) o git ignora. Não copie o projeto para outro lugar.';

/** What every fix must have, in the rounds being compared. */
const EVERY_FIX_TESTED =
  'Todo ponto corrigido ganha um teste que falharia sem a correção.';

const TEAM = 'uma equipe de três agentes: analista, programador e revisor.';

export default defineRound({
  id: 'analise-programacao-revisao',
  goal: 'Cada papel faz só a sua parte, e toda correção tem um teste que falha sem ela.',
  start: { git: { root, tag: 'rodada-base' } },
  actors: {
    analista: {
      provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
      workspace,
      readOnly: true,
    },
    programador: {
      provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
      workspace,
    },
    revisor: {
      provider: new CursorProvider({ model: 'gpt-5.6-terra' }),
      workspace,
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
        'Analise o projeto do diretório atual.',
        'Não altere nenhum arquivo do projeto e não faça perguntas: ninguém vai responder.',
        RUN_IN_PLACE,
        'Responda só com a lista de problemas, do mais importante para o menos importante, cada um com o arquivo e a linha.',
      ],
    },
    {
      actor: 'programador',
      prompt: ({ said }) => [
        `Você é o programador de ${TEAM}`,
        'O analista entregou a análise abaixo.',
        'Corrija os problemas que valem a pena corrigir.',
        EVERY_FIX_TESTED,
        'Não faça perguntas: ninguém vai responder. Quando houver uma decisão, escolha a opção mais simples e diga qual escolheu.',
        'Não faça commits.',
        'No fim, diga o que mudou, arquivo por arquivo, qual teste cobre cada correção, e o que deixou de fora e por quê.',
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
        'Não altere nenhum arquivo do projeto e não faça perguntas: ninguém vai responder.',
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
  rules: [readOnlyRespected(), noQuestions()],
});
