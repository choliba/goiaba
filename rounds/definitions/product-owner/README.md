# Rodada product-owner

O Product Owner, um modelo local no Ollama conduzido pelo Claude Code, transforma um problema em um ticket com
critérios de aceite em Gherkin, escrito em `ticket.md`. Para rodar:

```sh
bun run rounds product-owner
```

Cada peça da rodada mora no seu próprio arquivo, por menor que seja. Este documento mostra em que ordem as peças entram
em ação e o que cada uma faz. Registro, notas e páginas, que valem para todas as rodadas, estão em
[rounds/README.md](../../README.md).

## Índice

- [A ordem de execução](#a-ordem-de-execução)
  - [Ao carregar: os imports](#ao-carregar-os-imports)
  - [Ao rodar: o runRound](#ao-rodar-o-runround)
- [As peças](#as-peças)
- [Mudar a rodada](#mudar-a-rodada)
- [Veja também](#veja-também)

## A ordem de execução

A rodada passa por duas fases. Primeiro o arquivo é carregado, e os imports montam a declaração. Depois o `runRound`
executa a declaração.

### Ao carregar: os imports

`bun run rounds product-owner` procura a rodada em `rounds/definitions` (`findDefinition`), acha
[product-owner.ts](product-owner.ts) e o importa. O import puxa as outras peças nesta árvore:

```
product-owner.ts          defineRound(definition): confere a declaração
└─ definition.ts          junta as peças
   ├─ id.ts
   ├─ goal.ts
   ├─ start.ts
   ├─ actors.ts
   │  ├─ actor-name.ts
   │  └─ actor.ts
   │     ├─ provider.ts   cria o OllamaProvider já no import
   │     ├─ workspace.ts  chama roundDir(ID) já no import
   │     │  └─ id.ts
   │     └─ policy.ts
   ├─ flow.ts
   │  ├─ actor-name.ts
   │  └─ prompt.ts
   │     └─ problem.ts
   ├─ criteria.ts
   │  └─ actor-name.ts
   └─ rules.ts
```

Quase todas as peças só declaram valores. Duas fazem algo já no import:

- [provider.ts](provider.ts) cria o `OllamaProvider`;
- [workspace.ts](workspace.ts) chama `roundDir(ID)`, que lê o `rounds.dir` do `goiaba.config.ts`. Sem esse valor, o
  import falha com um `UsageError`. É por isso que a rodada só carrega pelo `bun run rounds`, que carrega a
  configuração antes.

No fim, o `defineRound` confere a declaração montada: campos desconhecidos, id inválido, critérios mal formados.

[↑ topo](#rodada-product-owner)

### Ao rodar: o runRound

O `runRound` ([src/rounds/run.ts](../../../src/rounds/run.ts)) executa a declaração. Em cada passo, entra uma peça:

1. **[start.ts](start.ts)**: a pasta da rodada, `roundDir(ID)` dentro de `rounds.dir`, é apagada e recebe uma cópia de
   `rounds/fixtures/site-vazio`, com um repositório git novo. É o ponto de partida.
2. **[flow.ts](flow.ts)**: cada passo do fluxo roda em ordem. Aqui há um só, o do Product Owner:
   1. [prompt.ts](prompt.ts) monta o pedido, com o texto de [problem.ts](problem.ts);
   2. um `Workspace` novo é criado com as opções de [workspace.ts](workspace.ts);
   3. como o ator tem critérios em [criteria.ts](criteria.ts), o workspace é lido antes do passo, para comparar o
      início com o fim;
   4. o `Agent` roda com o [provider.ts](provider.ts), a [policy.ts](policy.ts) e o pedido. A política nega o que não
      libera, e a fronteira de rede mede os tokens que vão e voltam do Ollama;
   5. o git é lido de novo: o que mudou aparece na tela, e os critérios do ator são conferidos;
   6. se o agente terminar sem responder nada, a rodada para.
3. **[rules.ts](rules.ts)**: as regras conferem a rodada inteira. Aqui, o `noQuestions` reprova o agente que fez
   perguntas.
4. O registro é gravado em `rounds/data/<início>.json`, com as medidas e as notas, e a página da rodada é oferecida.
5. Com `repeat` na declaração, os passos 1 a 4 se repetem, e cada execução grava o seu registro. Esta rodada não usa
   `repeat`.

[↑ topo](#rodada-product-owner)

## As peças

| Arquivo                              | O que é                                 | Quem usa                              |
| ------------------------------------ | --------------------------------------- | ------------------------------------- |
| [product-owner.ts](product-owner.ts) | a entrada: `defineRound(definition)`    | `bun run rounds product-owner`        |
| [definition.ts](definition.ts)       | a rodada montada, só junta as peças     | `product-owner.ts`                    |
| [id.ts](id.ts)                       | `ID`, o id da rodada                    | `definition.ts`, `workspace.ts`       |
| [goal.ts](goal.ts)                   | o objetivo da rodada                    | `definition.ts`                       |
| [start.ts](start.ts)                 | o ponto de partida: a fixture           | `definition.ts`                       |
| [actor-name.ts](actor-name.ts)       | `PRODUCT_OWNER`, o nome do agente       | `actors.ts`, `flow.ts`, `criteria.ts` |
| [actors.ts](actors.ts)               | quem participa: nome → ator             | `definition.ts`                       |
| [actor.ts](actor.ts)                 | o agente: provider + workspace + policy | `actors.ts`                           |
| [provider.ts](provider.ts)           | o modelo e o CLI que o conduz           | `actor.ts`                            |
| [workspace.ts](workspace.ts)         | onde o agente trabalha                  | `actor.ts`                            |
| [policy.ts](policy.ts)               | o que o agente pode fazer               | `actor.ts`                            |
| [flow.ts](flow.ts)                   | os passos, em ordem                     | `definition.ts`                       |
| [prompt.ts](prompt.ts)               | o pedido ao agente                      | `flow.ts`                             |
| [problem.ts](problem.ts)             | o problema que vira ticket              | `prompt.ts`                           |
| [criteria.ts](criteria.ts)           | o que a rodada confere no fim do passo  | `definition.ts`                       |
| [rules.ts](rules.ts)                 | as regras sobre a rodada inteira        | `definition.ts`                       |

### product-owner.ts

A entrada da rodada. O nome do arquivo tem que ser igual ao nome da pasta: o `findDefinition` procura
`<id>/<id>.ts`. Só chama `defineRound(definition)`, que confere a declaração e a exporta por padrão.

### definition.ts

Junta as peças num `RoundDefinition`: `id`, `goal`, `start`, `actors`, `flow`, `criteria` e `rules`. Nenhum valor
mora ali. Uma opção nova da rodada, como `repeat` ou `label`, vira uma peça nova importada aqui.

### id.ts

`ID = 'product-owner'`. É a única fonte do id: dá nome aos registros, à pasta da rodada (`roundDir(ID)`) e combina com
o nome desta pasta. Quem precisa do id importa daqui e não repete a string. O formato aceito é letras minúsculas,
dígitos e `-`.

### goal.ts

O objetivo da rodada, na língua de quem a lê. Aparece no topo das páginas da rodada.

### start.ts

De onde cada execução parte (`RoundStartDefinition`): a fixture `site-vazio`, uma pasta de `rounds/fixtures` com
`index.html`, `ticket.txt` e `README.md`. A outra forma possível, `git`, parte de uma tag num repositório que já existe.

### actor-name.ts

`PRODUCT_OWNER = 'product-owner'`, o nome do agente. Aparece nos passos, nas notas e nas chaves dos critérios. É igual
ao id da rodada por acaso, não por regra: uma rodada com vários agentes tem um nome para cada um.

### actors.ts

Quem participa da rodada, pelo nome: `{ [PRODUCT_OWNER]: actor }`. Um agente a mais entra como mais uma chave.

### actor.ts

O agente montado (`RoundActor`): `provider`, `workspace` e `policy`. Não tem `readOnly`, porque escrever o
`ticket.md` é justamente a tarefa.

### provider.ts

Quem conduz o modelo (`AgentProvider`): um `OllamaProvider` com o modelo `qwen3.5:4b`, conduzido pelo CLI `claude`.

- `contextWindow: 100_000`: perto desse número de tokens, o CLI compacta o histórico;
- `think: false`: o modelo responde sem raciocinar antes, com menos tokens e menos tempo por turno;
- `tools: ['file_write']`: só a capacidade da tarefa. O conjunto completo do Claude Code custa uns 15 mil tokens por
  pedido.

Para trocar de modelo ou de CLI, é só mexer aqui. Outras opções são `ClaudeProvider` e `CodexProvider`.

### workspace.ts

Onde o agente trabalha (`WorkspaceOptions`): um sandbox `bubblewrap` sobre a pasta da rodada, `roundDir(ID)`, com
`hostState: 'none'`, para que nada do host entre e o agente só enxergue essa pasta. Cada passo ganha um `Workspace`
novo com estas opções.

### policy.ts

O que o agente pode fazer (`AgentPolicy`). A política parte de `default: 'deny'` e libera só o necessário:

- ler e escrever em `/workspace/**`, a pasta da rodada vista de dentro do sandbox;
- rodar comandos que só olham: `ls`, `cat`, `find`, `pwd`, `git status`, `git diff`, `git log`.

Numa rodada ninguém responde, então o que não está liberado é negado na hora. Ter uma política é também o que liga a
fronteira de rede: sem ela, o tráfego do Ollama não é lido e os tokens não são medidos.

### flow.ts

Os passos da rodada, em ordem (`RoundFlowStep[]`). Aqui há um só: o `PRODUCT_OWNER` recebe o `prompt`. Um passo pode
usar `by` para dizer quem consulta o agente.

### prompt.ts

O pedido ao agente: o papel do Product Owner e o formato do ticket (numerado, em linguagem não técnica, com critérios
em Gherkin, escrito em `ticket.md`). É uma função que recebe o `said`, ou seja, o que cada agente disse nos passos
anteriores, e devolve as linhas do pedido. Esta rodada não usa o `said`, porque tem um passo só.

### problem.ts

O problema que vira ticket: mudar o header do site para a cor `#5f4e4e`. Fica separado do prompt para que o problema
possa ser trocado sem mexer no papel do agente.

### criteria.ts

O que a rodada confere sozinha no fim do passo do agente (`RoundCriteria`). É isso que entra na eficácia, os
"Critérios do prompt" na nota. Aqui, o `ticket.md` tem que existir e conter `Então` (do Gherkin) e `#5f4e4e`, sem
diferenciar maiúsculas e minúsculas.

O critério depende do [problem.ts](problem.ts): trocou a cor lá, troque aqui também.

### rules.ts

As regras que conferem a rodada inteira, de fora dos agentes, depois que ela termina (`RoundRule[]`). Aqui só o
`noQuestions()`, que reprova o agente que pergunta, porque numa rodada ninguém responde. O `readOnlyRespected` fica de
fora, porque este agente deve escrever.

[↑ topo](#rodada-product-owner)

## Mudar a rodada

| Para trocar                    | Mexa em                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| o modelo ou o CLI              | [provider.ts](provider.ts)                                                                |
| o problema                     | [problem.ts](problem.ts) e [criteria.ts](criteria.ts)                                     |
| o papel ou o formato do ticket | [prompt.ts](prompt.ts) e, se mudar o que se confere, [criteria.ts](criteria.ts)           |
| o que o agente pode fazer      | [policy.ts](policy.ts)                                                                    |
| o ponto de partida             | [start.ts](start.ts)                                                                      |
| o que reprova a rodada         | [rules.ts](rules.ts)                                                                      |
| mais um agente                 | um nome em `actor-name.ts`, o ator, e a entrada em `actors.ts`, `flow.ts` e `criteria.ts` |
| quantas vezes roda             | uma peça `repeat` importada em [definition.ts](definition.ts)                             |

[↑ topo](#rodada-product-owner)

## Veja também

- [rounds/README.md](../../README.md): o registro, as notas (eficácia, eficiência, eliminatórias) e as páginas.
- [src/rounds/define.ts](../../../src/rounds/define.ts): os tipos de cada peça.
- [src/rounds/run.ts](../../../src/rounds/run.ts): o `runRound`, passo a passo.

[↑ topo](#rodada-product-owner)
