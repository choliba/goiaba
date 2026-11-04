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

Execuções com a mesma configuração (os mesmos agentes, com o mesmo id e o mesmo objetivo) contam como repetições
umas das outras. Se você mudar os pedidos, mude o `goal`: os pedidos ficam fora dessa comparação, porque levam o que
os agentes disseram.

## Rodar

```sh
bun run rounds analise-programacao-revisao
```

A rodada aparece no terminal e, no fim, o registro fica em `data/`. Uma declaração errada (um campo desconhecido, um
agente que não existe) para antes de rodar, com uma mensagem dizendo o que corrigir.

## Ver as páginas

Nas páginas, cada configuração é um **teste**, e cada execução dele é uma **rodada**. O topo mostra os últimos testes
(`RECENT_TESTS`, em [`web/src/constants.ts`](web/src/constants.ts)), e um botão lista todos. A página de um teste
junta as suas rodadas (média, menor e maior) e tem um link para cada uma.

```sh
cd rounds/web && bun install   # uma vez
bun run rounds:web              # em desenvolvimento
bun run rounds:build            # gera rounds/web/dist, que abre de qualquer lugar
```

## O registro

O formato está em [`../src/rounds/types.ts`](../src/rounds/types.ts) (`RoundRecord`). Cada registro guarda:

- a configuração de cada agente: provider, workspace, regras de rede, o que a rede decidiu de fato e a política;
- o pedido de cada passo, as falas, as perguntas, as ferramentas e o diff;
- os tempos da rodada, de cada agente, de cada turno e de cada ferramenta;
- os tokens e o custo por agente e por ação;
- o resultado das regras;
- a revisão (`review`), escrita depois: o título, as cenas e o que olhar na próxima rodada.

O que não foi medido fica `null`, e não `0`. O Cursor, por exemplo, não informa custo.
