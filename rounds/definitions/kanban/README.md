# Rodada kanban

Seis agentes levam um ticket da criação ao aceite seguindo um fluxo kanban: solicitante, po, dev, revisor, devops e qa.
O ticket é um arquivo de texto que todos compartilham, e cada agente só age na sua vez e só na sua seção. Para rodar:

```sh
bun run rounds kanban
```

Este documento explica a lógica usada para montar a rodada: por que o fluxo é um rodízio, como cada agente sabe se é a
vez dele, como a rodada confere o que cada um fez e por que as peças recebem parâmetros. Registro, notas e páginas,
que valem para todas as rodadas, estão em [rounds/README.md](../../README.md).

## Índice

- [A ideia](#a-ideia)
- [O ponto de partida: a fixture](#o-ponto-de-partida-a-fixture)
- [O problema: um fluxo que anda e volta](#o-problema-um-fluxo-que-anda-e-volta)
- [A solução: um rodízio](#a-solução-um-rodízio)
  - [Quantos ciclos](#quantos-ciclos)
  - [Quem não está na vez responde uma linha](#quem-não-está-na-vez-responde-uma-linha)
- [A instrução de cada agente](#a-instrução-de-cada-agente)
- [Os critérios: conferir de acordo com a vez](#os-critérios-conferir-de-acordo-com-a-vez)
- [As peças recebem parâmetros](#as-peças-recebem-parâmetros)
- [A ordem de execução](#a-ordem-de-execução)
- [As peças](#as-peças)
- [Mudar a rodada](#mudar-a-rodada)
- [Limites conhecidos](#limites-conhecidos)

## A ideia

Num time de verdade, o quadro kanban é o que coordena as pessoas: ninguém precisa saber o que o outro está pensando,
basta olhar o cartão. Aqui o cartão é o `ticket.txt`. Ele diz em que fase o trabalho está (`FASE_ATUAL`), quem age
agora (`PROXIMO_ATOR`) e o que já aconteceu (`HISTORICO`). As regras de cada fase estão no `fluxo.txt`.

Os agentes não conversam entre si. Cada um lê os dois arquivos, decide se é a sua vez e, se for, preenche a sua seção
e passa a vez adiante. A rodada mede se uma equipe de agentes consegue manter esse quadro coerente do começo ao fim.

[↑ topo](#rodada-kanban)

## O ponto de partida: a fixture

Cada execução parte de uma cópia de [rounds/fixtures/kanban](../../fixtures/kanban/), numa pasta só da rodada
(`roundDir('kanban')`, dentro de `rounds.dir`), com um repositório git novo:

| Arquivo      | O que é                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `fluxo.txt`  | as regras: os atores, as fases e, para cada fase, o dono, os campos, a saída e as transições            |
| `ticket.txt` | o cartão em branco: `FASE_ATUAL: criacao`, `PROXIMO_ATOR: solicitante`, `RODADA: 1`, uma seção por fase |
| `index.html` | a página da demanda: o dev muda o header dela para a cor pedida                                         |

A parte "INSTRUCAO PARA CADA AGENTE" do fluxo original não está no `fluxo.txt`: ela virou o pedido de cada agente, no
[prompt.ts](prompt.ts).

[↑ topo](#rodada-kanban)

## O problema: um fluxo que anda e volta

O motor das rodadas roda uma **lista fixa de passos**, um depois do outro (`flow`). O kanban não é uma lista fixa:

- o po pode devolver o ticket ao solicitante (`precisa_info`) ou descartá-lo;
- o revisor pode pedir ajustes, o deploy pode falhar e o qa pode reprovar, e em todos esses casos o ticket volta ao
  dev;
- o po aparece duas vezes: no refinamento e no aceite.

Quem age depois depende do que o agente anterior escreveu, e isso só se sabe durante a execução. Não dá para escrever
a sequência certa de antemão.

[↑ topo](#rodada-kanban)

## A solução: um rodízio

Em vez de prever a sequência, a rodada passa por **todos os atores, na ordem, várias vezes**. Cada passada é um ciclo:

```
ciclo 1: solicitante → po → dev → revisor → devops → qa
ciclo 2: solicitante → po → dev → revisor → devops → qa
ciclo 3: solicitante → po → dev → revisor → devops → qa
```

Em cada passo, o agente lê o `PROXIMO_ATOR` do ticket. Se for ele, age. Se não for, não faz nada. A decisão de quem age
fica no ticket, como num kanban de verdade, e não na lista de passos.

No caminho feliz, o ticket anda assim:

| Ciclo | Passo       | O que acontece                                       | `PROXIMO_ATOR` depois |
| ----- | ----------- | ---------------------------------------------------- | --------------------- |
| 1     | solicitante | preenche tipo, descrição e critérios                 | po                    |
| 1     | po          | refinamento: prioridade, tamanho, `status: aprovado` | dev                   |
| 1     | dev         | `[x] testes escritos`, `[x] concluido`               | revisor               |
| 1     | revisor     | `status: aprovado`                                   | devops                |
| 1     | devops      | `status: sucesso`                                    | qa                    |
| 1     | qa          | `status: aprovado`                                   | po                    |
| 2     | solicitante | não é a vez dele                                     | po                    |
| 2     | po          | aceite: `status: aceito`                             | (nenhum)              |
| 2–3   | todos       | não é a vez de ninguém: a fase é `concluido`         | (nenhum)              |

### Quantos ciclos

O caminho feliz precisa de **2 ciclos**, porque o aceite do po só chega na segunda passada (o po vem antes do qa na
ordem). Cada volta (ajustes no review, falha no deploy, reprovação no teste) custa até mais um ciclo, porque o ticket
volta ao dev, que já passou naquele ciclo.

O [definition.ts](definition.ts) usa `cycles: 3`: o caminho feliz e uma volta. São 18 passos (6 atores × 3 ciclos).
Ciclos de sobra não estragam nada: depois do `concluido`, todos respondem que não é a sua vez. Mas cada passo custa
tempo e tokens, mesmo o que não faz nada, porque o agente precisa ler os arquivos para decidir.

### Quem não está na vez responde uma linha

O motor para a rodada quando um agente termina **sem responder nada**: entende que algo deu errado. Por isso o pedido
manda o agente fora da vez responder exatamente `Nao e a vez de <ator>.` e não alterar nenhum arquivo. Assim o
rodízio continua.

[↑ topo](#rodada-kanban)

## A instrução de cada agente

Todos recebem a mesma instrução, a do fluxo, com o próprio nome no lugar de `<ATOR>` ([prompt.ts](prompt.ts)):

1. leia `fluxo.txt` e `ticket.txt`;
2. se o `PROXIMO_ATOR` não for você, não altere nada e responda `Nao e a vez de <ator>.`;
3. senão, preencha só a seção com `dono: <ator>`, use as opções do fluxo, marque `[x]` no que fez, aplique a
   transição no cabeçalho e acrescente uma linha ao HISTORICO;
4. responda em uma linha o que fez; ninguém vai responder perguntas.

Dois atores recebem, depois da instrução comum, um **recado só deles** (o parâmetro `briefs` do `prompt`):

- **o solicitante** recebe a demanda ([demand.ts](demand.ts)): "O header do site deve ficar com a cor `#5f4e4e`." É a
  matéria-prima do ticket: ele a transforma em tipo, descrição e critérios de aceite;
- **o dev** recebe a tarefa de implementar ([dev-task.ts](dev-task.ts)): antes de marcar `[x] concluido`, alterar o
  `index.html` conforme a descrição e os critérios do ticket, e, se o ticket voltou do review ou do teste, corrigir o
  que as observações e os bugs apontam.

O dev não recebe a demanda direto: ele implementa o que está no **ticket**, ou seja, o que o solicitante escreveu e o
po aprovou. Se o ticket estiver mal escrito, a implementação reflete isso, como num time de verdade. É também a única
exceção à regra do fluxo de que cada ator só mexe na sua seção.

O nome de cada agente é exatamente o do fluxo (`solicitante`, `po`, `dev`…), definido em
[actors-names.ts](actors-names.ts). É por esse nome que o agente se reconhece no `PROXIMO_ATOR`, e é o mesmo que
aparece nas páginas da rodada.

[↑ topo](#rodada-kanban)

## Os critérios: conferir de acordo com a vez

A rodada confere cada passo sozinha, no fim dele ([criteria.ts](criteria.ts)). O problema é que o mesmo agente passa
várias vezes, e o que se espera dele depende de ser ou não a sua vez. Por isso cada agente tem um **critério
condicional**, avaliado com o ticket como estava **no início** do passo:

```
se o ticket.txt contém "PROXIMO_ATOR: <ator>"   (era a vez dele)
  confira: o ticket.txt mudou
           e ganhou uma linha "[rodada N] <ator> | …" no HISTORICO
           (e o que `extra` pedir para esse ator)
senão                                             (não era a vez dele)
  confira: nenhum arquivo mudou
```

Assim, um agente é reprovado tanto por não agir na sua vez quanto por mexer em qualquer arquivo fora dela.

Detalhes que importam:

- **A quebra de linha depois do nome.** A condição procura `PROXIMO_ATOR: dev` seguido de `\n`. Sem isso,
  `PROXIMO_ATOR: devops` também conteria `PROXIMO_ATOR: dev`, e o dev acharia que é a vez dele quando é a do devops.
- **`extra` por ator.** Critérios a mais na vez de um ator, sobre o ticket ou qualquer outro arquivo. Hoje são dois:
  - **solicitante:** o `tipo` no ticket tem que ser uma das opções do fluxo (`bug`, `feature`, `melhoria`,
    `debito_tecnico`);
  - **dev:** o `index.html` tem que conter `#5f4e4e`, ou seja, a demanda implementada. Não se exige que o
    `index.html` tenha mudado naquele passo: quando o ticket volta do review, a cor pode já estar lá.
- **O que não é conferido.** Os critérios não conferem se a transição foi a certa, se o `RODADA` foi somado nem se o
  agente mexeu só na sua seção. Isso aparece no `diff` de cada passo, nas páginas da rodada.

A regra [rules.ts](rules.ts) completa a conferência: `noQuestions()` reprova o agente que fez uma pergunta, porque
numa rodada ninguém responde.

[↑ topo](#rodada-kanban)

## As peças recebem parâmetros

Na rodada `product-owner`, cada peça é um valor pronto. Aqui, a maioria das peças é uma **função que recebe
parâmetros**, e o [definition.ts](definition.ts) é o **centralizador**: é o único lugar onde as escolhas são feitas.

```ts
export const definition: RoundDefinition = {
  id: ID,
  goal,
  start: start('kanban'),
  actors: actors(ACTOR_NAMES, () =>
    actor({
      provider: provider({ model: 'qwen3.5:4b', contextWindow: 100_000 }),
      workspace: workspace(ID),
      policy: policy(['ls *', 'cat *', 'pwd', 'git status', 'git diff *']),
    }),
  ),
  flow: flow({
    order: ACTOR_NAMES,
    cycles: 3,
    prompt: (name) =>
      prompt(name, {
        briefs: { solicitante: `A sua demanda: ${demand}`, dev: devTask },
      }),
  }),
  criteria: criteria({
    names: ACTOR_NAMES,
    extra: {
      solicitante: [
        {
          file: {
            name: 'ticket.txt',
            matches: [/^tipo: (bug|feature|melhoria|debito_tecnico)\s*$/m],
          },
        },
      ],
      dev: [{ file: { name: 'index.html', contains: ['#5f4e4e'] } }],
    },
  }),
  rules,
};
```

Por que assim:

- **As peças sabem montar; o definition.ts decide.** O modelo, a fixture, os comandos liberados, o número de ciclos,
  quem recebe qual recado e o que se confere de cada ator aparecem só no definition.ts. Para mudar a rodada, quase sempre basta mexer nele.
- **Seis atores, uma receita.** O `actors(names, make)` chama `make` para cada nome. Hoje todos recebem o mesmo
  modelo, mas como `make` recebe o nome, dá para decidir por ator (um modelo maior para o dev, por exemplo).
- **Um provider por ator.** Cada chamada de `provider(...)` cria um `OllamaProvider` novo, e cada ator fica com o
  seu.
- **A lista de atores é a fonte única.** `ACTOR_NAMES` alimenta os atores, a ordem do rodízio e os critérios. Um ator
  a mais no fluxo é um nome a mais nessa lista.

As peças que não têm o que parametrizar continuam valores: `ID`, `goal`, `demand`, `devTask` e `rules`.

[↑ topo](#rodada-kanban)

## A ordem de execução

**Ao carregar.** `bun run rounds kanban` acha [kanban.ts](kanban.ts), que importa o [definition.ts](definition.ts).
O definition.ts chama as peças com os parâmetros e monta a declaração. Duas coisas acontecem já nesse momento:
`provider(...)` cria um `OllamaProvider` para cada ator, e `workspace(ID)` chama `roundDir`, que lê o `rounds.dir` do
`goiaba.config.ts`. Por isso a rodada só carrega pelo `bun run rounds`, que lê a configuração antes. No fim, o
`defineRound` confere a declaração.

**Ao rodar** (`runRound`, em [src/rounds/run.ts](../../../src/rounds/run.ts)):

1. a pasta da rodada é apagada e recebe uma cópia da fixture, com um repositório git novo;
2. para cada um dos 18 passos, na ordem do rodízio:
   1. o `prompt` do ator monta o pedido;
   2. um `Workspace` novo é criado na pasta da rodada;
   3. a pasta é lida antes do passo (para o `if` dos critérios e para comparar o início com o fim);
   4. o agente roda com o seu provider, a política e o pedido;
   5. o git é lido de novo, e o critério condicional do ator é conferido;
   6. se o agente terminar sem responder nada, a rodada para;
3. a regra `noQuestions` confere a rodada inteira;
4. o registro vai para `rounds/data/<início>.json`, e a página da rodada é oferecida.

[↑ topo](#rodada-kanban)

## As peças

| Arquivo                            | O que é                                           | Parâmetros                        |
| ---------------------------------- | ------------------------------------------------- | --------------------------------- |
| [kanban.ts](kanban.ts)             | a entrada: `defineRound(definition)`              | —                                 |
| [definition.ts](definition.ts)     | o centralizador: chama as peças com as escolhas   | —                                 |
| [id.ts](id.ts)                     | `ID = 'kanban'`                                   | —                                 |
| [goal.ts](goal.ts)                 | a pergunta que a rodada quer responder            | —                                 |
| [actors-names.ts](actors-names.ts) | `ACTOR_NAMES`, os 6 atores na ordem do rodízio    | —                                 |
| [demand.ts](demand.ts)             | o que o solicitante quer                          | —                                 |
| [dev-task.ts](dev-task.ts)         | o recado do dev: implementar no index.html        | —                                 |
| [start.ts](start.ts)               | o ponto de partida                                | `fixture`                         |
| [provider.ts](provider.ts)         | o modelo no Ollama, conduzido pelo Claude Code    | `{ model, contextWindow, think }` |
| [workspace.ts](workspace.ts)       | a pasta da rodada, num sandbox bubblewrap         | `id`                              |
| [policy.ts](policy.ts)             | nega tudo, libera o workspace e os comandos dados | `commands`                        |
| [actor.ts](actor.ts)               | um agente: provider + workspace + policy          | `{ provider, workspace, policy }` |
| [actors.ts](actors.ts)             | nome → agente, montado por uma função             | `names`, `make`                   |
| [prompt.ts](prompt.ts)             | a instrução do fluxo, com o nome do ator          | `actor`, `{ briefs }`             |
| [flow.ts](flow.ts)                 | o rodízio                                         | `{ order, cycles, prompt }`       |
| [criteria.ts](criteria.ts)         | o critério condicional de cada ator               | `{ names, extra }`                |
| [rules.ts](rules.ts)               | `noQuestions()`                                   | —                                 |

Detalhes de algumas peças:

- **provider.ts** dá ao modelo só `file_read`, `file_edit` e `file_write`: ler os arquivos, editar o ticket e, no caso
  do dev, o `index.html`. O
  conjunto completo do Claude Code custa uns 15 mil tokens por pedido. `think` é `false` por padrão: o modelo responde
  sem raciocinar antes, com menos tokens e menos tempo.
- **workspace.ts** usa a mesma pasta para todos os atores: é o que faz o ticket ser compartilhado. `hostState: 'none'`
  impede que algo do host entre no sandbox.
- **policy.ts** parte de `default: 'deny'`: o que não está liberado é negado na hora, porque ninguém aprova nada numa
  rodada. Ter uma política também liga a fronteira de rede, que mede os tokens do Ollama.
- **actor.ts** não usa `readOnly`: todos os atores escrevem no ticket na sua vez, e o dev também no `index.html`.

[↑ topo](#rodada-kanban)

## Mudar a rodada

| Para trocar                        | Mexa em                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| o modelo de todos                  | `provider({ … })` no [definition.ts](definition.ts)                      |
| o modelo de um ator só             | a função passada a `actors(...)` no definition.ts, decidindo pelo `name` |
| quantas voltas o fluxo aguenta     | `cycles` no definition.ts                                                |
| o que o solicitante pede           | [demand.ts](demand.ts) e o `extra` do dev, que confere a cor             |
| o que o dev faz além do ticket     | [dev-task.ts](dev-task.ts)                                               |
| um recado para outro ator          | `briefs` no `prompt(...)` do definition.ts                               |
| as regras do kanban                | `fluxo.txt` e `ticket.txt` na [fixture](../../fixtures/kanban/)          |
| um ator a mais ou a menos          | [actors-names.ts](actors-names.ts), mais o `fluxo.txt` e o `ticket.txt`  |
| o que se confere na vez de um ator | `extra` em `criteria(...)` no definition.ts                              |
| os comandos liberados              | `policy([...])` no definition.ts                                         |

[↑ topo](#rodada-kanban)

## Limites conhecidos

- **A demanda aparece em dois lugares.** A cor `#5f4e4e` está no [demand.ts](demand.ts) e no `extra` do dev, no
  definition.ts. Trocou a demanda, troque o critério também.
- **Revisor, devops e qa não olham o código.** Eles só preenchem a sua seção do ticket: nenhum é instruído a conferir
  o `index.html`. Um recado em `briefs` pode pedir isso a eles (o qa conferir a cor, por exemplo).
- **O modelo pequeno se confunde.** Numa execução com o `qwen3.5:4b`, o solicitante não escreveu nada na sua vez, e o
  dev achou que o `PROXIMO_ATOR: solicitante` era ele. Se o solicitante não age, o resto da rodada vira passos de "não
  é a minha vez".
- **Cada passo custa, mesmo sem fazer nada.** Os 18 passos leem os arquivos. Ciclos de sobra custam tempo e tokens.
- **Os critérios conferem a forma, não o conteúdo.** Eles verificam que o ator mexeu no ticket e deixou uma linha no
  HISTORICO, mas não se a transição foi a certa. Para isso, olhe o `diff` de cada passo na página da rodada.

[↑ topo](#rodada-kanban)
