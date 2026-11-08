import { noQuestions, type RoundDefinition } from '../../../src/rounds';
import { policy } from './policy';
import { ProductOwnerProvider } from './provider';
import { workspace } from './workspace';
import { prompt } from './prompt';

export const ID: string = 'product-owner';
const productOwnerProvider = ProductOwnerProvider({
  // O CLI que conduz o modelo: o Claude Code.
  cli: 'claude',
  // O nome do modelo no Ollama (ollama list).
  model: 'qwen3.5:4b',
  // Quantos tokens de contexto o CLI acha que o modelo tem: perto disso
  // ele compacta o histórico (ollama ps mostra com quanto o modelo subiu).
  contextWindow: 100000,
  // Desliga o raciocínio do modelo: responde sem pensar antes, com menos
  // tokens e menos tempo por turno. O Goiaba escreve isso em cada pedido
  // ao Ollama, o que precisa de uma política (policy, abaixo).
  think: false,
  // Só a capacidade da tarefa, no vocabulário do Goiaba: escrever o
  // ticket.md. O conjunto completo do Claude Code custa uns 15 mil tokens por
  // pedido; o provider traduz file_write para o --tools Write do Claude.
  tools: ['file_write'],
});

export const definition: RoundDefinition = {
  // O mesmo id de cima: dá nome ao registro e à pasta.
  id: ID,
  // Para que serve a rodada: aparece no topo das páginas dela.
  goal: 'O Product Owner transforma um problema em um ticket com critérios de aceite em Gherkin',
  // Cada execução parte de uma cópia de rounds/fixtures/site-vazio
  // (index.html, ticket.txt, README.md); a pasta é apagada antes.
  start: {
    // A pasta em rounds/fixtures que vira o ponto de partida.
    fixture: 'site-vazio',
  },
  // Quem participa, pelo nome: aqui, um agente só.
  actors: {
    // O nome do agente: aparece nos passos, nas notas e nas instruções.
    'product-owner': {
      // O modelo e o CLI em que ele roda.
      provider: productOwnerProvider,
      // A pasta em que ele trabalha (a da rodada), dentro de um sandbox.
      workspace: workspace(ID),
      // A política dele: o que pode ler, escrever e rodar. Sem readOnly:
      // escrever o ticket.md é a tarefa.
      policy: policy,
    },
  },
  // Os passos, em ordem: aqui, um só.
  flow: [
    {
      // Quem age neste passo.
      actor: 'product-owner',
      // O que ele recebe como pedido (prompt.ts).
      prompt,
    },
  ],
  // O que o prompt pede, conferido no workspace no fim do passo: é o que a
  // eficácia ("Instruções do prompt") avalia.
  instructions: {
    // As instruções do passo deste agente.
    'product-owner': [
      {
        // Sem `when`: conferida sempre, no fim do passo. O ticket tem que ter
        // o "Então" do Gherkin (maiúsculas e minúsculas não importam).
        check: {
          // O arquivo conferido, a partir da raiz do workspace.
          file: 'ticket.md',
          contains: 'Então',
        },
      },
      {
        // E precisa tratar o problema do enunciado: a cor pedida.
        check: {
          file: 'ticket.md',
          contains: '#5f4e4e',
        },
      },
    ],
  },
  // Regras sobre a rodada inteira: perguntar elimina o agente (numa rodada
  // ninguém responde). O readOnlyRespected fica de fora: o agente deve
  // escrever.
  rules: [noQuestions()],
};
