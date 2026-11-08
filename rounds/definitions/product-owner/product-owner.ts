/**
 * Um Product Owner local (Ollama), do começo ao fim, sem perguntar nada:
 * recebe um problema e escreve um ticket com critérios de aceite em Gherkin
 * no arquivo ticket.md. Cada execução parte da fixture `site-vazio`, numa
 * pasta só dela (rounds.dir), e o git mostra o que ele escreveu.
 */

// defineRound confere a declaração; noQuestions reprova o agente que pergunta.
import { defineRound, noQuestions } from '../../../src/rounds/index';
// O que o agente pode fazer: ler e escrever no workspace, alguns comandos.
import { WRITE_WORKSPACE } from './policy';
// O prompt do passo: as linhas que o agente lê.
import { prompt } from './prompt';
import { ProductOwnerProvider } from './provider';
// Onde o agente trabalha: a pasta da rodada, num sandbox.
import { workspace } from './workspace';

// O nome da rodada: a pasta dela em rounds.dir e o teste nas páginas.
const id: string = 'product-owner';

/**
 * O modelo em que o agente roda: ele precisa chamar as ferramentas do CLI
 * de verdade. O qwen2.5-coder escrevia a chamada como texto
 * (`{"name": "exec_command", …}`) e nada rodava; o qwen3.5:4b é o que os
 * exemplos com Ollama (agents/) usam.
 */
const productOwnerProvider = ProductOwnerProvider({
  // O CLI que conduz o modelo: o Claude Code.
  cli: 'claude',
  // O nome do modelo no Ollama (ollama list).
  model: 'qwen3.5:4b',
  // Quantos tokens de contexto o CLI acha que o modelo tem: perto disso
  // ele compacta o histórico (ollama ps mostra com quanto o modelo subiu).
  contextWindow: 20000,
  // Desliga o raciocínio do modelo: responde sem pensar antes, com menos
  // tokens e menos tempo por turno. O Goiaba escreve isso em cada pedido
  // ao Ollama, o que precisa de uma política (permissions, abaixo).
  think: false,
  // Só a ferramenta da tarefa: escrever o ticket.md. O conjunto completo do
  // Claude Code custa uns 15 mil tokens por pedido.
  tools: ['Write'],
});

export default defineRound({
  // O mesmo id de cima: dá nome ao registro e à pasta.
  id,
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
      workspace: workspace(id),
      // A política dele: o que pode ler, escrever e rodar. Sem readOnly:
      // escrever o ticket.md é a tarefa.
      permissions: WRITE_WORKSPACE,
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
});
