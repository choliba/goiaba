import { OllamaProvider } from '../../src/index';
import { defineRound, noQuestions, roundDir } from '../../src/rounds/index';

const id = 'ollama-product-owner-2';
const root = roundDir(id);

export default defineRound({
  id,
  goal: 'O agente implementa o ticket: troca o título da página por Goiaba',
  start: { fixture: 'site-vazio' },
  actors: {
    'product-owner-2': {
      provider: new OllamaProvider({
        cli: 'codex',
        model: 'qwen3.5:4b',
        contextWindow: 20000,
      }),
      workspace: { type: 'bubblewrap', root, hostState: 'none' },
      policy: {
        default: 'deny',
        allow: {
          filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
          execution: [
            {
              operations: ['run'],
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
      },
    },
  },
  flow: [
    {
      actor: 'product-owner-2',
      prompt: () => [
        'leia o arquivo só o for pra implementar do ticket.txt',
        'Com base nas instruções dele implemente a alteração no index.html **NADA MAIS**',
        'Apenas implemente a solicitação escrita em ticket.txt',
        'o nome do arquivo a ser lido é ticket.txt',
        '**NÃO TENTE ACESSAR NENHUM SITE NA WEB**',
      ],
    },
  ],
  rules: [noQuestions()],
});
