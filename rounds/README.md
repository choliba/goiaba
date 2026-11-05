# Rodadas

Uma rodada põe uma equipe de agentes para trabalhar do começo ao fim, sem perguntar nada a ninguém, e mede o que
cada um fez: tempo, turnos, ferramentas, tokens, custo e o que o git mostrou que mudou. Cada execução vira um
registro em JSON, e as páginas em [`web/`](web/) comparam uma execução com as outras.

## Índice

- [Onde fica cada coisa](#onde-fica-cada-coisa)
- [Declarar uma rodada](#declarar-uma-rodada)
- [Rodar](#rodar)
- [Ver as páginas](#ver-as-páginas)
- [O registro](#o-registro)
- [Avaliação: as notas de cada rodada](#avaliação-as-notas-de-cada-rodada)
  - [Eficácia: o que foi entregue](#eficácia-o-que-foi-entregue)
  - [Eficiência: o que custou entregar](#eficiência-o-que-custou-entregar)
  - [Eliminatórias](#eliminatórias)
  - [A nota da rodada](#a-nota-da-rodada)
  - [Gabarito e limites](#gabarito-e-limites)
  - [Os números da rubrica](#os-números-da-rubrica)

## Onde fica cada coisa

| Caminho                               | O que é                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| [`../src/rounds`](../src/rounds)      | o motor: `defineRound`, `runRound`, as medidas e o validador do registro |
| [`definitions/<id>.ts`](definitions/) | as rodadas declaradas                                                    |
| [`data/<início>.json`](data/)         | um registro por execução, gravado pelo `runRound`                        |
| [`web/`](web/)                        | as páginas (React), geradas a partir dos registros                       |
| [`run.ts`](run.ts)                    | a linha de comando: `bun run rounds <id>`                                |

A rodada não entra no `runScript` nem no `Agent.run()`. Ela só declara quem participa e em que ordem, e o
`runRound` monta os agentes. Os agentes não sabem que estão numa rodada: o `runRound` os acompanha pelos eventos.

## Declarar uma rodada

Um arquivo em `definitions/`, com o nome do id da rodada, que exporta a declaração por padrão:

```ts
import { ClaudeProvider, getConfig } from '../../src/index';
import { defineRound, readOnlyRespected } from '../../src/rounds/index';

const root = getConfig().workspaces.dir;
const workspace = {
  type: 'docker',
  image: 'FROM busybox:latest',
  root,
  hostState: 'none',
} as const;

export default defineRound({
  id: 'so-analise',
  goal: 'O analista aponta os problemas sem alterar nenhum arquivo.',
  start: { git: { root, tag: 'rodada-base' } },
  actors: {
    analista: {
      provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
      workspace,
      readOnly: true,
    },
  },
  flow: [
    {
      actor: 'analista',
      prompt: () => ['Analise o projeto do diretório atual.'],
    },
  ],
  rules: [readOnlyRespected()],
});
```

- `start.git`: toda execução volta o workspace a essa tag antes de começar. Sem isso, ninguém confere o que cada
  agente alterou.
- `flow`: os passos, em ordem. O `prompt` de um passo recebe o que cada agente disse no seu último passo
  (`({ said }) => [...]`).
- `rules`: o que se confere de fora depois da execução (`readOnlyRespected`, `noQuestions`).
- `repeat`: quantas vezes rodar a mesma configuração. Uma execução só não basta para comparar configurações.
- `label`: o que mudou desde a última execução, nas suas palavras. `bun run rounds <id> --label "…"` vale mais.
- `expected` e `limits`: o gabarito e os limites, que entram nas notas (veja
  [Gabarito e limites](#gabarito-e-limites)).

Rodadas com a mesma configuração (os mesmos agentes, com o mesmo objetivo) são comparáveis entre si, e as páginas tiram a
média delas. Se você mudar os pedidos, mude o `goal`: os pedidos ficam fora dessa comparação, porque levam o que os
agentes disseram.

## Rodar

```sh
bun run rounds analise-programacao-revisao
```

A rodada aparece no terminal e, no fim, o registro fica em `data/`. Uma declaração errada (um campo desconhecido, um
agente que não existe) para antes de rodar, com uma mensagem dizendo o que corrigir.

## Ver as páginas

Nas páginas, cada declaração é um **teste**, com o nome do seu `id`, e cada execução dela é uma
**rodada**, mude o que mudar entre uma e outra. Cada rodada diz o que mudou desde a anterior: modelo, CLI, política,
pedidos. O topo mostra os últimos testes (`RECENT_TESTS`, em [`web/src/constants.ts`](web/src/constants.ts)), e um
botão lista todos. As médias só juntam rodadas da mesma configuração.

```sh
cd rounds/web && bun install   # uma vez
bun run rounds:web              # em desenvolvimento
bun run rounds:build            # gera rounds/web/dist, que abre de qualquer lugar
```

## O registro

O formato está em [`../src/rounds/types.ts`](../src/rounds/types.ts) (`RoundRecord`, `schema: 3`). Cada registro guarda:

- a configuração de cada agente: provider, workspace, regras de rede, o que a rede decidiu de fato e a política;
- o pedido de cada passo, as falas, as perguntas, as ferramentas, o diff e as referências `arquivo:linha` conferidas;
- o tempo e os tokens em três níveis: cada passo (`steps[i].span`, `steps[i].totals`), cada agente
  (`timing.actors`, `totals.actors`) e a rodada (`timing`, `totals.round`);
- os tokens novos (`fresh`) em cada um desses níveis: o que o modelo leu fora do cache, mais o que escreveu;
- o resultado das regras, o gabarito e os limites declarados (`criteria`), e o `label`;
- a revisão (`review`), escrita depois: o título, as cenas e o que olhar na próxima rodada.

Cada passo tem uma chave estável, `agente#n` (o n-ésimo passo daquele agente): é por ela que rodadas diferentes são
comparadas, e por ela que um gráfico junta "o passo do analista" de todas as rodadas, mesmo que o `flow` mude.

O tempo da rodada é o decorrido no relógio, e é maior que a soma dos agentes: inclui o reset e a conferência do git
entre os passos. O que não foi medido fica `null`, e não `0`. O Cursor, por exemplo, não informa custo, e o Ollama só
informa tokens quando a rodada tem regras de rede (`permissions`).

## Avaliação: as notas de cada rodada

Cada agente recebe duas notas, de 0 a 5, e elas nunca são somadas numa só:

|           | Eficácia                                        | Eficiência                                                                    |
| --------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Pergunta  | atingiu o objetivo?                             | quanto gastou, e desperdiçou, para chegar lá?                                 |
| Olha para | o resultado, independentemente dos recursos     | os meios: tempo, tokens e processo                                            |
| Exemplo   | entregou o que o gabarito pede, mesmo demorando | entregou com menos tempo e tokens que o normal, sem erros nem passos refeitos |

Manter as duas separadas mostra em que direção uma mudança empurrou a rodada: melhorou o resultado, ou só barateou?
Cada rodada cai num destes quadrantes: eficaz e eficiente; eficaz e cara; barata e ineficaz; nem uma nem outra.

As notas são calculadas pela rubrica, em [`../src/rounds/score.ts`](../src/rounds/score.ts), a partir dos fatos do
registro. A rubrica tem versão (`RUBRIC_VERSION`, hoje **1**), e a página mostra qual foi usada. Mudou um critério, a
versão sobe, e todas as rodadas, antigas e novas, passam a ser avaliadas do mesmo jeito.

Um critério sem o que medir fica **não avaliado** (`—` na página), e não `0`: a média de uma dimensão é a média dos
critérios avaliados. Uma dimensão sem nenhum critério avaliado fica sem nota.

### Eficácia: o que foi entregue

A nota de eficácia de um agente é a média destes critérios:

| Critério                 | Como é medido                                                                                                                                                         | Nota                                                       | Quando não é avaliado                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| **Completude**           | cada ponto do gabarito do agente (`expected`) aparece no que ele disse, sem diferenciar maiúsculas                                                                    | `5 × achados ÷ pontos`. Achou 2 de 3: 3,3                  | sem gabarito para o agente                                |
| **Referências corretas** | cada `arquivo:linha` (ou `arquivo:início-fim`) que ele citou existe no workspace como estava no início da rodada (a tag de partida), e a linha está dentro do arquivo | `5 × válidas ÷ citadas`                                    | sem ponto de partida no git, ou nenhuma referência citada |
| **Limite de tempo**      | o tempo gasto pelo agente (a soma dos seus passos) contra o limite declarado (`limits.actorMs`)                                                                       | dentro: 5; acima: 0. Estourar o prazo é não atingir a meta | sem limite declarado                                      |

As referências são conferidas contra o início da rodada: uma linha que o próprio agente acrescentou depois não conta.

### Eficiência: o que custou entregar

A eficiência tem duas partes de peso igual:

| Parte        | Critério                     | Como é medido                                                                                                                                                    | Nota                                        |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Recursos** | **Tempo gasto**              | o tempo do agente (a soma dos seus passos), não o decorrido da rodada                                                                                            | contra a referência (abaixo)                |
|              | **Tokens novos**             | o que o agente leu fora do cache, mais o que escreveu (`fresh`), não o total                                                                                     | contra a referência (abaixo)                |
| **Processo** | **Processo sem desperdício** | perguntas numa rodada em que ninguém responde, ferramentas que falharam e destinos de rede negados pela política (os que o próprio provider bloqueia não contam) | começa em 5 e perde 1 por ocorrência, até 0 |

**A referência** é a mediana do mesmo agente nas rodadas anteriores do mesmo teste. Contra ela:

| Razão (valor ÷ referência)              | Nota                        |
| --------------------------------------- | --------------------------- |
| até 0,75 (um quarto a menos, ou melhor) | 5                           |
| 1 (igual ao normal)                     | 3                           |
| 2 ou mais (o dobro, ou pior)            | 0                           |
| entre esses pontos                      | proporcional, em linha reta |

Na primeira rodada de um teste não há referência, e tempo e tokens ficam não avaliados. A parte de recursos é a média
de tempo e tokens.

**A nota de eficiência** junta as duas partes e escala pela eficácia, porque eficiência é o máximo de resultado com o
mínimo de recursos:

```
base       = (recursos + processo) ÷ 2
eficiência = base × eficácia ÷ 5
```

Quem gasta pouco e entrega metade fica com metade da base; quem não entrega nada, com zero. Sem nota de eficácia (sem
gabarito nem referências), a eficiência fica sem nota, e a página mostra só a base.

### Eliminatórias

Se o agente violou uma destas, as duas notas dele são 0, e a página diz por quê:

| Eliminatória                                                             | Vem de                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| alterou arquivos com o pedido de não alterar                             | a regra `readOnlyRespected` (quando a rodada a declara) |
| respondeu com uma chamada de ferramenta escrita como texto, e nada rodou | a regra `noToolCallAsText` (quando a rodada a declara)  |
| terminou sem entregar nada                                               | o último passo do agente sem nenhuma fala               |

### A nota da rodada

A eficácia da rodada é a média das eficácias dos agentes avaliados, mais os limites da rodada, quando declarados
(`limits.roundMs`, o tempo decorrido, e `limits.costUsd`, o custo total: dentro dá 5, acima dá 0). A eficiência da
rodada é a média das eficiências dos agentes. A página diz quantos agentes entraram na média.

### Gabarito e limites

Os dois ficam na declaração e são copiados para cada registro (`criteria`), para que uma rodada possa ser avaliada sozinha,
anos depois:

```ts
export default defineRound({
  id: 'analise-programacao-revisao',
  // …
  expected: {
    // Cada entrada é um ponto: achado quando o texto aparece no que o agente disse.
    analista: ['usuariosPadrao', 'Object.freeze', 'buscarPorId'],
    programador: ['Object.freeze', 'teste'],
  },
  limits: {
    roundMs: 120_000, // a rodada inteira, no relógio
    actorMs: { analista: 45_000 }, // cada agente, a soma dos seus passos
    costUsd: 0.5, // a rodada inteira
  },
});
```

O gabarito é a peça que mais pesa na eficácia: sem ele, só as referências `arquivo:linha` avaliam o resultado. Escreva
pontos curtos e específicos, que só apareceriam numa resposta certa.

### Os números da rubrica

Ficam em [`../src/rounds/constants.ts`](../src/rounds/constants.ts) (`RUBRIC`), cada um com o motivo do valor:

| Número         | Valor | O que é                                    |
| -------------- | ----- | ------------------------------------------ |
| `best`         | 0,75  | até 75% da referência, nota 5              |
| `worst`        | 2     | o dobro da referência, ou mais, nota 0     |
| `wastePenalty` | 1     | pontos tirados do processo por desperdício |

Mudou um desses, ou um critério, suba `RUBRIC_VERSION` em `score.ts`.
