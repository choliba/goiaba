<a id="topo"></a>

# Módulo rounds: comparar agentes com fatos

Uma **rodada** é um experimento repetível com agentes: quem participa (provider, workspace, política), em que ordem
cada um age, de onde todos partem e o que se confere no fim. Ela existe para responder perguntas como "o qwen3.5:4b
cria o arquivo pedido?", "o Codex respeita a política melhor que o Claude Code?" ou "trocar o prompt melhorou ou só
barateou?". E responde **com fatos**, não com a opinião de quem leu as respostas.

Três ideias sustentam o módulo:

- **Declarar, não programar.** Uma rodada é um objeto (`defineRound`) que diz quem faz o quê. O motor (`runRound`)
  monta os agentes, roda, mede e grava. Os agentes não sabem que estão numa rodada.
- **Partir sempre do mesmo lugar.** Toda execução começa do mesmo ponto: uma fixture copiada para uma pasta nova, ou
  uma tag de um repositório. Só assim duas execuções são comparáveis, e só assim o git diz o que cada agente mudou.
- **Medir o que aconteceu.** O registro de cada execução (um JSON) e as notas saem só do que o sistema observou:
  eventos dos agentes, o git do workspace, as decisões da política. Nada é escrito depois, nem por pessoa nem por
  agente.

```
declaração ──▶ runRound ──▶ pasta da rodada (fixture ou tag) ──▶ passo 1 ─▶ passo 2 ─▶ … ──▶ regras
  (defineRound)                     │                               │ git antes/depois        │
                                    └──── rounds.dir (fora do ──────┘ eventos medidos         ▼
                                          projeto)                                     registro JSON
                                                                                             │
                                                     scoreRound (notas) ◀── páginas ◀────────┘
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`defineRound` e a declaração](#defineround-e-a-declaração)
  - [Os agentes e os passos](#os-agentes-e-os-passos)
  - [`start`: de onde a rodada parte](#start-de-onde-a-rodada-parte)
  - [`instructions` e `limits`](#instructions-e-limits)
  - [As regras](#as-regras)
  - [`runRound` e as opções](#runround-e-as-opções)
  - [`roundDir`](#rounddir)
  - [Ler e avaliar registros](#ler-e-avaliar-registros)
  - [Peças que dá para usar sozinhas](#peças-que-dá-para-usar-sozinhas)
- [Como funciona](#como-funciona)
  - [Uma execução, do começo ao fim](#uma-execução-do-começo-ao-fim)
  - [Onde a rodada roda: `rounds.dir`](#onde-a-rodada-roda-roundsdir)
  - [Fixture ou repositório, e as travas](#fixture-ou-repositório-e-as-travas)
  - [O que é medido](#o-que-é-medido)
  - [O registro](#o-registro)
  - [As notas](#as-notas)
  - [Linha de comando, limpeza e páginas](#linha-de-comando-limpeza-e-páginas)
- [Exemplos](#exemplos)
  - [1. Declarar uma rodada](#1-declarar-uma-rodada)
  - [2. A primeira rodada](#2-a-primeira-rodada)
  - [3. Dois agentes, instruções e regras](#3-dois-agentes-instruções-e-regras)
  - [4. As notas](#4-as-notas)
  - [5. As referências `arquivo:linha`](#5-as-referências-arquivolinha)
  - [6. Partir de um repositório, e as travas](#6-partir-de-um-repositório-e-as-travas)
  - [7. Rodadas de verdade](#7-rodadas-de-verdade)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

O motor fica em `src/rounds`; o que é de cada rodada fica em `rounds/`, versionado no projeto.

| Arquivo                      | Papel                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/rounds/index.ts`        | O que o módulo exporta.                                                                                                                                       |
| `src/rounds/define.ts`       | `defineRound` e os tipos da declaração (`RoundDefinition`, `RoundActor`, `RoundFlowStep`, `RoundRule`).                                                       |
| `src/rounds/run.ts`          | `runRound`: prepara a partida, roda os passos, mede, confere e grava.                                                                                         |
| `src/rounds/git.ts`          | O git da rodada: `prepareFixture`, `resetTo`, as travas (`assertOwnRepository`, `assertApart`), o diff.                                                       |
| `src/rounds/dir.ts`          | `roundDir(id)`: a pasta de uma rodada dentro do `rounds.dir`.                                                                                                 |
| `src/rounds/instructions.ts` | Confere as `instructions` no workspace, no início e no fim de cada passo.                                                                                     |
| `src/rounds/rules.ts`        | As regras prontas: `readOnlyRespected`, `noQuestions`, `noToolCallAsText`.                                                                                    |
| `src/rounds/references.ts`   | Tira as citações `arquivo:linha` do que o agente disse e confere cada uma.                                                                                    |
| `src/rounds/measures.ts`     | `StepRecorder`: ouve os eventos de um passo (falas, perguntas, ferramentas, tokens).                                                                          |
| `src/rounds/record.ts`       | Monta e grava o registro, tirando segredos e o caminho do projeto.                                                                                            |
| `src/rounds/score.ts`        | A rubrica: `scoreRound`, as notas de eficácia, eficiência e a final.                                                                                          |
| `src/rounds/validate.ts`     | `validateRound`: confere um registro lido do disco, campo a campo.                                                                                            |
| `src/rounds/types.ts`        | O formato do registro (`RoundRecord`, `schema: 4`).                                                                                                           |
| `src/rounds/constants.ts`    | Os valores do módulo: a rubrica, os caminhos fixos, a tag das fixtures.                                                                                       |
| `rounds/definitions/<id>.ts` | As rodadas declaradas, uma por arquivo, com o nome do `id`; ou, se quiser separar as peças em arquivos, uma pasta `<id>/` com a declaração em `<id>/<id>.ts`. |
| `rounds/fixtures/<nome>/`    | Os pontos de partida, copiados para a pasta da rodada a cada execução.                                                                                        |
| `rounds/data/<início>.json`  | Um registro por execução, gravado pelo `runRound`.                                                                                                            |
| `rounds/run.ts`              | A linha de comando: `bun run rounds <id>`.                                                                                                                    |
| `rounds/web/`                | As páginas (React), geradas a partir dos registros.                                                                                                           |
| `rounds/README.md`           | A referência da rubrica: cada critério, cada número e o motivo dele.                                                                                          |

[↑ topo](#topo)

## Interface

Tudo sai de `src/rounds/index.ts`, menos as peças avulsas indicadas.

### `defineRound` e a declaração

`defineRound(definition)` confere a declaração e a devolve como veio. Uma declaração errada é um `UsageError` que diz
o que corrigir, antes de qualquer agente rodar ([Exemplo 1](#1-declarar-uma-rodada)).

| Campo          | Tipo                                  | O que é                                                                                                       |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                              | Letras minúsculas, números e hífens. É o endereço do teste nas páginas e o nome do arquivo.                   |
| `goal`         | `string`                              | O que a rodada quer descobrir, em português. Rodadas com outro `goal` são outra configuração.                 |
| `label`        | `string?`                             | O que mudou desde a última execução, nas suas palavras. Só uma nota; `--label` na linha de comando vale mais. |
| `start`        | `RoundStartDefinition?`               | De onde toda execução parte: `{ fixture }` ou `{ git: { root, tag } }`. Sem ele, nada é conferido pelo git.   |
| `actors`       | `Record<string, RoundActor>`          | Os agentes, pelo nome do papel (`analista`, `programador`).                                                   |
| `flow`         | `RoundFlowStep[]`                     | Os passos, em ordem. Um agente pode aparecer em vários.                                                       |
| `rules`        | `RoundRule[]?`                        | O que se confere de fora, depois de rodar.                                                                    |
| `instructions` | `Record<string, RoundInstruction[]>?` | Por agente, as partes do prompt que a rodada confere sozinha.                                                 |
| `limits`       | `RoundLimits?`                        | Limites de tempo e custo, declarados antes: cumprir faz parte da meta.                                        |
| `repeat`       | `number?`                             | Quantas vezes rodar; cada execução tem o seu registro. 1 por padrão.                                          |

Um campo desconhecido também é recusado: um erro de digitação não passa em silêncio.

### Os agentes e os passos

```ts
interface RoundActor {
  provider: AgentProvider; // qual CLI roda (ClaudeProvider, OllamaProvider…)
  workspace: WorkspaceOptions; // onde: um Workspace novo a cada passo do agente
  permissions?: AgentPolicy; // a política dele
  readOnly?: boolean; // pedido de não alterar nada: o git confere
}

interface RoundFlowStep {
  actor: string; // quem age
  by?: string; // quem o consulta (só aparece na tela: "Product-owner consulta analista")
  prompt: (context: RoundContext) => readonly string[]; // as linhas do pedido, juntadas com \n
}

interface RoundContext {
  said: Readonly<Record<string, string>>; // por agente, tudo o que disse no último passo
}
```

O `prompt` é uma função porque um passo usa o que os anteriores disseram: `({ said }) => ['Corrija:',
said['analista'] ?? '']`. Todo agente deve trabalhar na pasta da rodada (`workspace.root`): a rodada confere antes de
começar.

### `start`: de onde a rodada parte

```ts
type RoundStartDefinition =
  | { fixture: string } // uma pasta de rounds/fixtures, copiada para roundDir(id)
  | { git: { root: string; tag: string } }; // uma tag de um repositório que já existe
```

Um dos dois, nunca os dois. O nome da fixture é só o nome da pasta (`site-vazio`), sem `/` nem `..`. Os dois modos
estão em [Fixture ou repositório, e as travas](#fixture-ou-repositório-e-as-travas).

### `instructions` e `limits`

Uma **instrução** é um pedido do prompt que deixa (ou não deixa) algo no workspace, conferido sem interpretar texto:

```ts
interface RoundInstruction {
  when?: { file: string; contains?: string }; // a condição, conferida no início do passo
  check: RoundCheck; // o que tem que ser verdade no fim do passo
  otherwise?: RoundCheck; // o que tem que ser verdade se a condição não valeu
}

type RoundCheck =
  | { file: string; contains?: string } // o arquivo existe (e tem o trecho, sem diferenciar maiúsculas)
  | { unchanged: true }; // o agente não alterou nada no passo
```

- `file` é relativo à raiz do workspace (`tickets/ticket-01.txt`); caminho absoluto ou com `..` é recusado.
- Sem `when`, o `check` vale sempre. Com `when` que não valeu e sem `otherwise`, a instrução não se aplica.
- `otherwise` sem `when` é recusado.
- O registro guarda só o veredito (o que foi conferido, se cumpriu, por quê), nunca o conteúdo do arquivo.

Os **limites** entram na eficácia: dentro dá 5, acima dá 0.

```ts
interface RoundLimits {
  roundMs?: number; // a rodada inteira, no relógio, em ms
  actorMs?: Record<string, number>; // cada agente, a soma dos seus passos, em ms
  costUsd?: number; // a rodada inteira, em dólares
}
```

### As regras

Uma regra olha os passos como rodaram e a declaração de cada agente, e diz se cada um cumpriu:

| Regra                 | Id                     | Confere                                                                                                          | Eliminatória? |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| `readOnlyRespected()` | `read-only-respected`  | quem tem `readOnly` não alterou nada fora do que a política dele libera para escrita                             | sim           |
| `noQuestions()`       | `no-questions`         | ninguém perguntou nada (numa rodada, ninguém responde)                                                           | não           |
| `noToolCallAsText()`  | `no-tool-call-as-text` | ninguém respondeu com uma chamada de ferramenta escrita como texto (`{"name": "exec_command"…}`), sem nada rodar | sim           |

Uma regra própria é um objeto `RoundRule`:

```ts
interface RoundRule {
  id: string;
  check(input: RuleInput): readonly RuleResult[]; // { rule, actor, passed, detail }
}
```

O `RuleInput` traz, de cada passo, `actor`, `said`, `changed` (as linhas do `git status`) e `asked`; e, de cada agente,
`readOnly` e `writable` (onde a política deixa escrever, como `tickets/**`).

### `runRound` e as opções

`runRound(definition, options)` roda todas as repetições, em ordem, e devolve os caminhos dos registros.

| Opção       | Tipo                                | O que é                                                                                                 |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `dir`       | `string`                            | Onde gravar os registros, um `<início>.json` por execução.                                              |
| `project`   | `string`                            | O projeto do Goiaba: tem as fixtures, vira `<projeto>` nos registros e nenhuma rodada roda dentro dele. |
| `roundsDir` | `string?`                           | Onde as rodadas de fixture rodam. Por padrão, o `rounds.dir` do `goiaba.config.ts`.                     |
| `screen`    | `Interaction?`                      | Onde os agentes mostram o que fazem. Por padrão, a conversa no terminal.                                |
| `signal`    | `AbortSignal?`                      | Para a rodada. Por padrão, o Ctrl+C do `runScript`.                                                     |
| `label`     | `string?`                           | O que mudou nesta execução; vale mais que o `label` da declaração.                                      |
| `price`     | `(model, tokens) => number \| null` | O custo de um pedido que a CLI não informa. Por padrão, nenhum (`null`).                                |

Uma falha antes do primeiro agente (declaração, fixture que não existe, trava) não grava registro.

### `roundDir`

`roundDir(id)` devolve `<rounds.dir>/<id>`, a pasta de uma rodada de fixture. Sem `rounds.dir` no `goiaba.config.ts`, é
um `UsageError` que diz como configurar. As declarações usam assim:

```ts
const id = 'ollama-product-owner';
const root = roundDir(id); // o workspace de todo agente da rodada
```

### Ler e avaliar registros

| Função                        | O que faz                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `validateRound(value, file?)` | Confere um registro lido do disco (campos, tipos, totais) e o devolve tipado como `RoundRecord`.               |
| `scoreRound(record, history)` | As notas de um registro; `history` são as execuções anteriores do mesmo teste, a referência de tempo e tokens. |
| `RUBRIC_VERSION`              | A versão da rubrica (hoje `'3'`). Mudou um critério, a versão sobe e tudo é reavaliado do mesmo jeito.         |

`scoreRound` devolve, por agente (`actors`), `final`, `eliminated`, `effectiveness` e `efficiency`, cada dimensão com
os seus critérios (`id`, `label`, `score` de 0 a 5 ou `null`, `detail`); e o mesmo para a rodada (`round`).

### Peças que dá para usar sozinhas

| Peça                           | De onde                    | O que faz                                                                                  |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `parseReferences(text)`        | `src/rounds/references.ts` | As citações `arquivo:linha` e `arquivo:início-fim` de um texto, sem repetir.               |
| `checkReferences(text, lines)` | `src/rounds/references.ts` | Quantas foram citadas, quantas existem e quais não, pelo número de linhas de cada arquivo. |
| `writableOf(policy)`           | `src/rounds/index.ts`      | Onde uma política deixa escrever, relativo ao workspace (`tickets/**`).                    |

[↑ topo](#topo)

## Como funciona

### Uma execução, do começo ao fim

1. **A partida.** Com `start.fixture`, a pasta da rodada é apagada, recebe a fixture e um repositório novo com a tag
   `rodada-base`. Com `start.git`, o repositório volta à tag (`checkout --force` e `clean -fd`). Antes, as travas.
2. **Cada passo do `flow`**, em ordem:
   - o `prompt` do passo recebe o que cada agente disse no último passo dele (`said`);
   - as condições (`when`) das instruções do agente são conferidas no workspace;
   - um `Agent` novo roda o pedido uma vez, num `Workspace` novo, sem conversa: ninguém responde. Se ele pergunta, a
     rodada responde que ninguém vai responder e que ele decida;
   - o `StepRecorder` ouve os eventos do agente: falas, perguntas, ferramentas, tokens, custo;
   - o git compara o workspace antes e depois: o que mudou (`changed`) e o diff;
   - as instruções são conferidas no fim do passo, e as referências `arquivo:linha` do que ele disse, contra a tag.
   - Se o agente terminou sem dizer nada, a rodada para ali.
3. **As regras** olham todos os passos.
4. **O registro** é montado, sem segredos nem o caminho do projeto, conferido pelo `validateRound` e gravado.

Com `repeat`, tudo isso se repete, cada vez a partir do zero.

### Onde a rodada roda: `rounds.dir`

As rodadas rodam numa pasta **fora do projeto**, o `rounds.dir` do `goiaba.config.ts`. Ele é obrigatório para rodar
uma rodada de fixture e não tem valor padrão:

```ts
export default defineConfig({
  rounds: { dir: '~/.local/share/goiaba/rodadas' },
});
```

O caminho é relativo ao arquivo de configuração (ou começa com `~/`). Ao carregar a configuração, o Goiaba recusa um
`rounds.dir` dentro do projeto, igual a ele ou que o contenha (com `~/dev`, a rodada `goiaba` cairia no projeto),
comparando caminhos reais: um link simbólico não engana.

**Por que fora:** a pasta de uma rodada é apagada antes de cada execução, e o git dela nunca pode ser o do Goiaba.
Dentro do projeto, uma pasta sem `.git` próprio faz o git subir até o repositório do Goiaba, e o reset cairia nele.

**O que fica no projeto** é o que é versionado e revisado: `rounds/definitions`, `rounds/fixtures` e `rounds/data`.
Esses caminhos são fixos (`ROUNDS_DEFINITIONS_DIR`, `ROUNDS_FIXTURES_DIR`, `ROUNDS_DATA_DIR`), não opções: são a
estrutura do repositório, e as páginas e a linha de comando precisam saber onde procurar.

### Fixture ou repositório, e as travas

|                          | `start: { fixture: 'site-vazio' }`                         | `start: { git: { root, tag } }`                     |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| Para quê                 | um ponto de partida pequeno, versionado no Goiaba          | um projeto de verdade, que já tem o seu repositório |
| Onde roda                | `roundDir(id)`, dentro do `rounds.dir`                     | o `root` que a declaração diz                       |
| A cada execução          | apaga a pasta, copia a fixture, cria o repositório e a tag | volta à tag: `checkout --force` e `clean -fd`       |
| A tag                    | `rodada-base` (`FIXTURE_TAG`), criada pelo motor           | a que você criou no repositório                     |
| Quem faz o commit        | um autor `goiaba`, não o seu git                           | você, quando marcou a tag                           |
| `bun run clear --rounds` | pode apagar: a próxima execução recria                     | não toca                                            |

No modo `git`, use uma cópia que só sirva às rodadas: o `clean -fd` apaga o que não está no git.

**As travas** valem nos dois modos e rodam antes de qualquer `checkout`, `clean` ou remoção:

1. **A pasta é a raiz do próprio repositório.** `git rev-parse --show-toplevel` tem que ser a pasta da rodada. Se não
   for, o git subiria até o repositório em volta, e a rodada para.
2. **A pasta não se sobrepõe ao projeto do Goiaba**: nem é ele, nem está dentro dele, nem o contém.
3. **No modo fixture, só um filho direto do `rounds.dir` é apagado.**
4. **Todo agente trabalha na pasta da rodada.** Um `workspace.root` diferente é recusado: o git conferiria uma pasta e
   o agente trabalharia em outra.

### O que é medido

| Medida            | De onde vem                                                | Onde fica no registro                |
| ----------------- | ---------------------------------------------------------- | ------------------------------------ |
| falas e perguntas | os eventos do agente                                       | `steps[i].said`, `steps[i].asked`    |
| ferramentas       | os eventos do agente (chamada e resultado)                 | `steps[i].tools`                     |
| tokens e custo    | o que a CLI informa (ou o tráfego do Ollama, com política) | `usage`, `steps[i].totals`, `totals` |
| tempo             | o relógio, por passo, por agente e da rodada               | `steps[i].span`, `timing`            |
| o que mudou       | o git, antes e depois de cada passo                        | `steps[i].changed`, `steps[i].diff`  |
| instruções        | o workspace, no início e no fim do passo                   | `steps[i].instructions`              |
| referências       | o que o agente disse, contra a tag de partida              | `steps[i].references`                |
| rede              | as decisões da fronteira de rede de cada agente            | `actors[nome].network.decisions`     |
| regras            | as `rules` da declaração                                   | `violations`                         |

O que não foi medido fica `null`, nunca `0`. O Cursor não informa custo; o Ollama só informa tokens quando o agente tem
política (é ela que dá a fronteira de rede que lê o tráfego).

### O registro

Um JSON por execução, em `rounds/data/<início>.json` (o formato está em `src/rounds/types.ts`, `RoundRecord`,
`schema: 4`). Ele guarda a configuração de cada agente (provider, workspace, política, rede), a partida
(`start.tag`, `start.commit`, `start.fixture`), cada passo e os totais.

O registro também guarda a declaração com que a rodada rodou, em dados (`declaration`): o objetivo, a partida, cada
agente (provider, CLI, modelo, workspace, política, `readOnly`), o `flow` com os pedidos (com `{{said:analista}}` no
lugar do que outro agente disse), as instruções, os limites, as regras e a repetição. Não é preciso commitar a
definição a cada mudança: na página da rodada, **Copiar definição** escreve de volta o arquivo de
`rounds/definitions/<id>.ts` (`declarationSource`). Registros anteriores a isso não têm o bloco, e o botão não aparece.

Cada passo tem uma chave estável, `agente#n` (o n-ésimo passo daquele agente): é por ela que execuções diferentes são
comparadas, mesmo que o `flow` mude. Execuções com a mesma configuração (os mesmos agentes, com o mesmo objetivo) têm o
mesmo `configHash`, e só essas entram juntas nas médias.

### As notas

Cada agente recebe três notas, de 0 a 5:

```
nota final = 60% × eficácia + 40% × base da eficiência
```

- **Eficácia**: atingiu o objetivo? Média de instruções do prompt, permissões, referências corretas e limite de tempo.
- **Eficiência**: quanto gastou para chegar lá? Tempo e tokens contra a mediana das execuções anteriores do mesmo
  agente, mais o processo sem desperdício (perguntas, ferramentas com erro). A base é escalada pela eficácia: quem
  gasta pouco e não entrega fica com zero.
- **Eliminatórias** zeram as três: violar `readOnlyRespected` ou `noToolCallAsText`, ou terminar sem entregar nada.

Um critério sem o que medir fica **não avaliado** (`—`), não `0`. Sem nenhum critério de eficácia (instrução,
política, `readOnly`, referência ou limite), não há eficácia, e sem ela não há nota final. Cada critério, cada número e
o motivo dele estão em [`rounds/README.md`](../../rounds/README.md#avaliação-as-notas-de-cada-rodada).

### Linha de comando, limpeza e páginas

```sh
bun run rounds ollama-product-owner                   # roda rounds/definitions/ollama-product-owner.ts
bun run rounds ollama-product-owner --label "qwen3.5" # com o que mudou nesta execução
bun run clear --rounds                                # esvazia o rounds.dir (pergunta antes; -y não pergunta)
bun run rounds:web                                    # as páginas, em desenvolvimento
bun run rounds:build                                  # gera rounds/web/dist, que abre de qualquer lugar
```

Nas páginas, cada declaração é um **teste** e cada execução, uma **rodada**. O índice filtra por agente, provider, CLI
e modelo; a página de um teste lista as rodadas, o que mudou entre elas e as médias por configuração; os dois têm um
gráfico XY (eixos escolhidos entre data, nota, eficácia, eficiência, tempo, tokens, custo, turnos, ferramentas,
perguntas e arquivos) em que cada ponto abre um cartão com links para o teste e a rodada.

[↑ topo](#topo)

## Exemplos

Os exemplos estão em `guides/rounds/exemplos/` e rodam como estão (`bun guides/rounds/exemplos/<arquivo>.ts`). Os que
rodam agentes usam um provider de mentira, em que a "CLI" é o próprio bun: rodam sem modelo nem rede, mas passam pelo
mesmo caminho de um agente de verdade (sandbox bubblewrap, eventos, git). Eles usam a fixture `site-vazio` do projeto e
uma pasta temporária no cache do Goiaba no lugar do `rounds.dir`, apagada no fim. Nas saídas, o home aparece como
`/home/dev`.

### 1. Declarar uma rodada

Uma declaração certa volta como veio; cada erro vira uma mensagem que diz o que corrigir, antes de rodar qualquer coisa.

`guides/rounds/exemplos/1-declarar.ts`

```ts
/**
 * Exemplo 1 do curso de rounds: declarar uma rodada. `defineRound` confere
 * a declaração antes de qualquer agente rodar: uma declaração certa volta
 * como veio; uma errada é um UsageError que diz o que corrigir. Não roda
 * nada: só confere.
 */
import { UsageError } from '../../../src/errors';
import { writeOut } from '../../../src/output/stdio';
import type { Provider } from '../../../src/providers/types';
import {
  defineRound,
  noQuestions,
  type RoundDefinition,
} from '../../../src/rounds/index';

/** Um provider que nunca roda: aqui só a declaração é conferida. */
const provider: Provider<string, string> = {
  id: 'nenhum',
  createCommand: () => ({ executable: 'true', arguments: [] }),
  parseOutput: async function* () {},
};

/** Uma declaração certa: um agente, um passo, uma regra. */
const base: RoundDefinition = {
  id: 'so-analise',
  goal: 'O analista aponta os problemas sem alterar nada.',
  start: { fixture: 'site-vazio' },
  actors: {
    analista: {
      provider,
      workspace: { type: 'bubblewrap', root: '/tmp/rodadas/so-analise' },
      readOnly: true,
    },
  },
  flow: [{ actor: 'analista', prompt: () => ['Analise o projeto.'] }],
  rules: [noQuestions()],
};

const ok = defineRound(base);
writeOut(`certa: ${ok.id}, ${String(ok.flow.length)} passo(s)\n\n`);

/** Cada uma com um erro só, e a mensagem que ele dá. */
const wrong: [string, RoundDefinition][] = [
  ['id com maiúsculas', { ...base, id: 'So-Analise' }],
  ['sem objetivo', { ...base, goal: ' ' }],
  [
    'passo de quem não está em actors',
    { ...base, flow: [{ actor: 'revisor', prompt: () => [] }] },
  ],
  [
    'fixture que não é um nome de pasta',
    { ...base, start: { fixture: '../fora' } },
  ],
  [
    'otherwise sem when',
    {
      ...base,
      instructions: {
        analista: [
          { check: { file: 'a.txt' }, otherwise: { unchanged: true } },
        ],
      },
    },
  ],
  ['repeat zero', { ...base, repeat: 0 }],
];

for (const [label, definition] of wrong) {
  try {
    defineRound(definition);
    writeOut(`${label}: aceita\n`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    writeOut(`${label}:\n  ${error.message}\n`);
  }
}
```

Saída:

```
certa: so-analise, 1 passo(s)

id com maiúsculas:
  O id da rodada ("So-Analise") deve ter só letras minúsculas, números e hífens, como analise-programacao-revisao.
sem objetivo:
  A rodada so-analise não diz o que quer identificar: preencha o goal.
passo de quem não está em actors:
  A rodada so-analise: o passo 1 usa actor "revisor", que não está em actors (analista).
fixture que não é um nome de pasta:
  A rodada so-analise: start.fixture deve ser o nome de uma pasta de rounds/fixtures, como site-vazio; veio "../fora".
otherwise sem when:
  A rodada so-analise: instructions.analista tem otherwise sem when: o otherwise vale quando a condição (when) não vale.
repeat zero:
  A rodada so-analise: repeat deve ser um inteiro a partir de 1, veio 0.
```

### 2. A primeira rodada

Um agente, um passo, uma fixture. A tela mostra a partida (a tag e o commit criados para a fixture), o que o agente
disse e o que o git viu mudar; o registro guarda o mesmo.

`guides/rounds/exemplos/2-primeira-rodada.ts`

```ts
/**
 * Exemplo 2 do curso de rounds: a primeira rodada. Um agente parte da
 * fixture `site-vazio` (rounds/fixtures), numa pasta só dele fora do
 * projeto, escreve um arquivo e responde. O registro sai num arquivo JSON,
 * e o exemplo mostra o que ele guardou. O provider é de mentira (a "CLI" é o
 * próprio bun), para rodar sem modelo nem rede.
 */
import { randomUUID } from 'node:crypto';

import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
  resolve,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  runRound,
  validateRound,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que cria index.html na pasta onde roda e diz o que fez. */
class SiteProvider implements Provider<string, string> {
  public readonly id = 'site';

  public describe(): { name: string; model: string } {
    return { name: 'site', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "require('fs').writeFileSync('index.html', '<h1>Olá</h1>\\n'); process.stdout.write('Criei o index.html.')",
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

/** O Goiaba: onde ficam as fixtures (rounds/fixtures). */
const project = resolve(import.meta.dir, '../../..');
// Fora do projeto, como o rounds.dir exige; e um lugar só para os registros.
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const roundsDir = join(scratch, 'rodadas');
const records = join(scratch, 'registros');
ensureDirectory(roundsDir);
ensureDirectory(records);

const id = 'primeira-rodada';
const root = join(roundsDir, id);

await runScript(async () => {
  try {
    const [file = ''] = await runRound(
      defineRound({
        id,
        goal: 'O agente cria o index.html.',
        start: { fixture: 'site-vazio' },
        actors: {
          dev: {
            provider: new SiteProvider(),
            workspace: { type: 'bubblewrap', root },
          },
        },
        flow: [{ actor: 'dev', prompt: () => ['Crie um index.html.'] }],
      }),
      { dir: records, project, roundsDir },
    );

    const record = validateRound(JSON.parse(readText(file)));
    const step = record.steps[0];
    writeOut(
      [
        '',
        `registro: ${file.slice(scratch.length + 1)}`,
        `partida: fixture ${String(record.start?.fixture)}, tag ${String(record.start?.tag)}`,
        `passo: ${step.key}`,
        `pedido: ${step.prompt.text}`,
        `disse: ${step.said.join(' ')}`,
        `alterou: ${step.changed.join(', ')}`,
        '',
      ].join('\n'),
    );
  } finally {
    removePath(scratch);
  }
});
```

Saída:

```
Workspace no ponto de partida: rodada-base (3fa7beb)
Dev…
Criei o index.html.
O dev alterou:
?? index.html

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/94d53153-98de-4e06-bcb8-6d08c5115d0f/registros/2026-11-06T14-19-30.874Z.json

registro: registros/2026-11-06T14-19-30.874Z.json
partida: fixture site-vazio, tag rodada-base
passo: dev#1
pedido: Crie um index.html.
disse: Criei o index.html.
alterou: ?? index.html
```

- `dev#1` é a chave do passo: o primeiro passo do agente `dev`.
- `?? index.html` é a linha do `git status`: um arquivo novo.

### 3. Dois agentes, instruções e regras

O product owner escreve o ticket; o analista recebe o que ele disse no próprio pedido (`said`), mas grava um arquivo
mesmo com `readOnly`. A rodada confere as instruções de cada um e as regras, sem ler o que eles disseram.

`guides/rounds/exemplos/3-dois-agentes.ts`

```ts
/**
 * Exemplo 3 do curso de rounds: dois agentes, instruções e regras. O
 * product owner escreve um ticket; o analista recebe o que ele disse, mas,
 * mesmo com `readOnly`, grava um arquivo. A rodada confere sozinha as
 * instruções de cada um (o arquivo existe? tem o trecho? não alterou nada?)
 * e as regras, e o exemplo mostra os vereditos que ficaram no registro. O
 * provider é de mentira (a "CLI" é o próprio bun): escreve os arquivos que
 * recebeu e responde o texto que recebeu.
 */
import { randomUUID } from 'node:crypto';

import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
  resolve,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  noQuestions,
  readOnlyRespected,
  runRound,
  validateRound,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que grava `files` (caminho → conteúdo) e responde `answer`. */
class ScriptProvider implements Provider<string, string> {
  public readonly id = 'roteiro';

  public constructor(
    private readonly answer: string,
    private readonly files: Readonly<Record<string, string>> = {},
  ) {}

  public describe(): { name: string; model: string } {
    return { name: 'roteiro', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    const script = [
      "const fs = require('fs');",
      "const path = require('path');",
      `for (const [file, text] of Object.entries(${JSON.stringify(this.files)})) {`,
      '  fs.mkdirSync(path.dirname(file), { recursive: true });',
      '  fs.writeFileSync(file, text);',
      '}',
      `process.stdout.write(${JSON.stringify(this.answer)});`,
    ].join('\n');
    return { executable: runtimeExecutable(), arguments: ['-e', script] };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

const project = resolve(import.meta.dir, '../../..');
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const roundsDir = join(scratch, 'rodadas');
const records = join(scratch, 'registros');
ensureDirectory(roundsDir);
ensureDirectory(records);

const id = 'ticket-e-analise';
const root = join(roundsDir, id);
const workspace = { type: 'bubblewrap', root } as const;

await runScript(async () => {
  try {
    const [file = ''] = await runRound(
      defineRound({
        id,
        goal: 'O product owner escreve o ticket e o analista só lê.',
        start: { fixture: 'site-vazio' },
        actors: {
          'product-owner': {
            provider: new ScriptProvider('O ticket está pronto.', {
              'tickets/ticket-01.txt': 'Implementar um rodapé vazio.\n',
            }),
            workspace,
          },
          analista: {
            provider: new ScriptProvider('Basta um <footer></footer>.', {
              'notas.txt': 'rascunho\n',
            }),
            workspace,
            readOnly: true,
          },
        },
        flow: [
          {
            actor: 'product-owner',
            prompt: () => ['Escreva o ticket em tickets/ticket-01.txt.'],
          },
          {
            actor: 'analista',
            by: 'product-owner',
            prompt: ({ said }) => [
              'Leia o ticket e diga como implementar. Não altere nada.',
              `O product owner disse: ${said['product-owner'] ?? ''}`,
            ],
          },
        ],
        instructions: {
          // "Escreva o ticket em tickets/ticket-01.txt."
          'product-owner': [
            { check: { file: 'tickets/ticket-01.txt', contains: 'rodapé' } },
          ],
          // "Não altere nada", se o ticket estava lá quando ele começou.
          analista: [
            {
              when: { file: 'tickets/ticket-01.txt' },
              check: { unchanged: true },
            },
          ],
        },
        rules: [readOnlyRespected(), noQuestions()],
      }),
      { dir: records, project, roundsDir },
    );

    const record = validateRound(JSON.parse(readText(file)));
    const lines = [''];
    for (const step of record.steps) {
      lines.push(
        step.key,
        `  pedido: ${step.prompt.text.replace(/\n/g, ' / ')}`,
      );
      for (const instruction of step.instructions) {
        lines.push(
          `  instrução: ${instruction.check} → ${instruction.met ? 'cumpriu' : 'não cumpriu'} (${instruction.detail})`,
        );
      }
    }
    lines.push('regras:');
    for (const result of record.violations) {
      lines.push(
        `  ${result.rule} · ${result.actor}: ${result.passed ? 'cumpriu' : 'violou'} (${result.detail})`,
      );
    }
    writeOut(`${lines.join('\n')}\n`);
  } finally {
    removePath(scratch);
  }
});
```

Saída:

```
Workspace no ponto de partida: rodada-base (83966f7)
Product-owner…
O ticket está pronto.
O product-owner alterou:
?? tickets/ticket-01.txt

Product-owner consulta analista
Analista…
Basta um <footer></footer>.
⚠ O analista alterou arquivos, mesmo com o pedido de não alterar:
?? notas.txt

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/6cddc6b8-79de-4e54-be50-8a9ff8ac8198/registros/2026-11-06T14-19-31.005Z.json

product-owner#1
  pedido: Escreva o ticket em tickets/ticket-01.txt.
  instrução: tickets/ticket-01.txt contém "rodapé" → cumpriu (tickets/ticket-01.txt contém "rodapé".)
analista#1
  pedido: Leia o ticket e diga como implementar. Não altere nada. / O product owner disse: O ticket está pronto.
  instrução: não alterou nada → não cumpriu (Alterou: ?? notas.txt.)
regras:
  read-only-respected · analista: violou (Alterou arquivos fora do que a política libera para escrita: ?? notas.txt)
  no-questions · product-owner: cumpriu (Não fez nenhuma pergunta.)
  no-questions · analista: cumpriu (Não fez nenhuma pergunta.)
```

- A instrução do analista tem `when`: o ticket existia quando ele começou, então o `check` (`unchanged`) valeu, e ele
  não cumpriu.
- `read-only-respected` violada é eliminatória: as notas do analista seriam 0.

### 4. As notas

A mesma rodada três vezes (`repeat: 3`). A primeira não tem com o que comparar tempo e tokens; a segunda gasta menos
tokens que a primeira (nota 5); a terceira, quase o triplo da mediana (nota 0).

`guides/rounds/exemplos/4-notas.ts`

```ts
/**
 * Exemplo 4 do curso de rounds: as notas. A mesma rodada roda três vezes
 * (`repeat: 3`), cada execução com o seu registro. A rubrica (`scoreRound`)
 * avalia cada uma contra as anteriores: a primeira não tem referência de
 * tempo e tokens; a segunda gasta menos tokens que a primeira; a terceira,
 * muito mais. O provider é de mentira (a "CLI" é o próprio bun) e informa
 * os tokens de cada execução, como uma CLI de verdade informa os dela.
 */
import { randomUUID } from 'node:crypto';

import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
  resolve,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  runRound,
  scoreRound,
  validateRound,
  type RoundRecord,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Cria index.html e informa `tokens[n]` tokens lidos na n-ésima execução. */
class CountingProvider implements Provider<string, string> {
  public readonly id = 'contador';
  private runs = 0;

  public constructor(private readonly tokens: readonly number[]) {}

  public describe(): { name: string; model: string } {
    return { name: 'contador', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "require('fs').writeFileSync('index.html', '<h1>Olá</h1>\\n'); process.stdout.write('Pronto.')",
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let text = '';
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') text += chunk;
    }
    const input = this.tokens[this.runs] ?? 0;
    this.runs += 1;
    yield {
      type: 'usage',
      usage: { input, output: 100, cachedInput: 0, cacheWrite: 0 },
    };
    yield { type: 'output', value: text };
  }
}

const project = resolve(import.meta.dir, '../../..');
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const roundsDir = join(scratch, 'rodadas');
const records = join(scratch, 'registros');
ensureDirectory(roundsDir);
ensureDirectory(records);

const id = 'tres-vezes';

await runScript(async () => {
  try {
    const files = await runRound(
      defineRound({
        id,
        goal: 'O agente cria o index.html.',
        start: { fixture: 'site-vazio' },
        actors: {
          dev: {
            provider: new CountingProvider([1000, 700, 3000]),
            workspace: { type: 'bubblewrap', root: join(roundsDir, id) },
          },
        },
        flow: [{ actor: 'dev', prompt: () => ['Crie um index.html.'] }],
        // Sem uma instrução conferível, não há eficácia, e sem ela, nota final.
        instructions: { dev: [{ check: { file: 'index.html' } }] },
        repeat: 3,
      }),
      { dir: records, project, roundsDir },
    );

    const history: RoundRecord[] = [];
    const lines = [''];
    for (const file of files) {
      const record = validateRound(JSON.parse(readText(file)));
      const score = scoreRound(record, history);
      const dev = score.actors['dev'];
      lines.push(
        `execução ${String(history.length + 1)}: nota ${String(dev.final)} · eficácia ${String(dev.effectiveness.score)} · eficiência ${String(dev.efficiency.score)}`,
      );
      for (const criterion of [
        ...dev.effectiveness.criteria,
        ...dev.efficiency.criteria,
      ]) {
        lines.push(
          `  ${criterion.label}: ${criterion.score === null ? '—' : String(criterion.score)} (${criterion.detail})`,
        );
      }
      history.push(record);
    }
    writeOut(`${lines.join('\n')}\n`);
  } finally {
    removePath(scratch);
  }
});
```

Saída:

```
Rodada tres-vezes: execução 1 de 3
Workspace no ponto de partida: rodada-base (83966f7)
Dev…
Pronto.
O dev alterou:
?? index.html

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/aab9399e-0d46-420a-8f91-c04e52a3749a/registros/2026-11-06T14-19-31.189Z.json
Rodada tres-vezes: execução 2 de 3
Workspace no ponto de partida: rodada-base (83966f7)
Dev…
Pronto.
O dev alterou:
?? index.html

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/aab9399e-0d46-420a-8f91-c04e52a3749a/registros/2026-11-06T14-19-31.274Z.json
Rodada tres-vezes: execução 3 de 3
Workspace no ponto de partida: rodada-base (83966f7)
Dev…
Pronto.
O dev alterou:
?? index.html

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/aab9399e-0d46-420a-8f91-c04e52a3749a/registros/2026-11-06T14-19-31.345Z.json

execução 1: nota 5 · eficácia 5 · eficiência 5
  Instruções do prompt: 5 (Cumpriu as 1 instruções: index.html existe.)
  Permissões: — (Sem política nem readOnly para conferir.)
  Referências corretas: — (Não citou nenhum arquivo:linha.)
  Limite de tempo: — (Sem limite declarado.)
  Tempo gasto: — (0 s; sem rodadas anteriores para comparar.)
  Tokens novos: — (1 mil tokens novos; sem rodadas anteriores para comparar.)
  Processo sem desperdício: 5 (Nenhum desperdício: sem perguntas nem ferramentas com erro.)
execução 2: nota 5 · eficácia 5 · eficiência 4.9
  Instruções do prompt: 5 (Cumpriu as 1 instruções: index.html existe.)
  Permissões: — (Sem política nem readOnly para conferir.)
  Referências corretas: — (Não citou nenhum arquivo:linha.)
  Limite de tempo: — (Sem limite declarado.)
  Tempo gasto: 4.4 (0 s, contra a mediana de 0 s nas rodadas anteriores.)
  Tokens novos: 5 (1 mil tokens novos, contra a mediana de 1 mil tokens novos nas rodadas anteriores.)
  Processo sem desperdício: 5 (Nenhum desperdício: sem perguntas nem ferramentas com erro.)
execução 3: nota 4.4 · eficácia 5 · eficiência 3.4
  Instruções do prompt: 5 (Cumpriu as 1 instruções: index.html existe.)
  Permissões: — (Sem política nem readOnly para conferir.)
  Referências corretas: — (Não citou nenhum arquivo:linha.)
  Limite de tempo: — (Sem limite declarado.)
  Tempo gasto: 3.5 (0 s, contra a mediana de 0 s nas rodadas anteriores.)
  Tokens novos: 0 (3 mil tokens novos, contra a mediana de 1 mil tokens novos nas rodadas anteriores.)
  Processo sem desperdício: 5 (Nenhum desperdício: sem perguntas nem ferramentas com erro.)
```

- Sem política nem `readOnly`, "Permissões" fica não avaliada (`—`); sem referência citada, "Referências" também.
- O tempo aqui é de milissegundos e varia de uma execução para outra: as notas de "Tempo gasto" mudam a cada vez que o
  exemplo roda. Com agentes de verdade, a diferença é de segundos ou minutos.

### 5. As referências `arquivo:linha`

Do que o agente disse saem as citações; cada uma é conferida contra o ponto de partida. Uma citação repetida conta uma
vez, e `1.2` não é referência (precisa de `arquivo.extensão:linha`).

`guides/rounds/exemplos/5-referencias.ts`

```ts
/**
 * Exemplo 5 do curso de rounds: as referências `arquivo:linha`. Do que o
 * agente disse, a rodada tira cada citação (`src/app.ts:12`,
 * `package.json:3-5`) e confere se o arquivo existia no ponto de partida e
 * se a linha está dentro dele. Aqui o "ponto de partida" é uma tabela
 * (arquivo → número de linhas), no lugar do git da rodada. Não roda agente
 * nenhum.
 */
import { writeOut } from '../../../src/output/stdio';
import {
  checkReferences,
  parseReferences,
} from '../../../src/rounds/references';

/** O que o agente respondeu. */
const said = [
  'O problema está em src/app.ts:12 e se repete em src/app.ts:40-44.',
  'A dependência fica em package.json:3-5; veja também src/util.ts:7.',
  'Repito: src/app.ts:12. A versão 1.2 não é referência.',
].join('\n');

/** Quantas linhas cada arquivo tinha no início da rodada. */
const linesAtStart: Readonly<Record<string, number>> = {
  'src/app.ts': 42,
  'package.json': 20,
};

writeOut('citadas:\n');
for (const reference of parseReferences(said)) {
  writeOut(
    `  ${reference.text} → ${reference.path}, linha ${String(reference.line)}\n`,
  );
}

const checked = await checkReferences(said, (path) =>
  Promise.resolve(linesAtStart[path]),
);
writeOut(
  `\ncitadas: ${String(checked.cited)} · existem: ${String(checked.valid)} · não existem: ${checked.invalid.join(', ')}\n`,
);
```

Saída:

```
citadas:
  src/app.ts:12 → src/app.ts, linha 12
  src/app.ts:40-44 → src/app.ts, linha 44
  package.json:3-5 → package.json, linha 5
  src/util.ts:7 → src/util.ts, linha 7

citadas: 4 · existem: 2 · não existem: src/app.ts:40-44, src/util.ts:7
```

`src/app.ts:40-44` não existe porque o arquivo tinha 42 linhas: vale a última linha do intervalo. `src/util.ts` não
existia no início.

### 6. Partir de um repositório, e as travas

O modo `start.git`, com um repositório que já existe: a execução volta à tag e tira o que sobrou da última. Depois, uma
pasta sem `.git` próprio dentro desse repositório: a rodada recusa antes de mexer em qualquer coisa.

`guides/rounds/exemplos/6-partir-de-um-repositorio.ts`

```ts
/**
 * Exemplo 6 do curso de rounds: partir de um repositório que já existe
 * (`start.git`), como um projeto de verdade, e as travas. Primeiro um
 * repositório próprio com a tag: a rodada volta a ele, sem o que sobrou da
 * última vez. Depois uma pasta sem `.git` próprio, dentro desse
 * repositório: a rodada recusa antes de mexer em qualquer coisa, e o
 * arquivo pendente do repositório em volta continua lá. O provider é de
 * mentira (a "CLI" é o próprio bun).
 */
import { randomUUID } from 'node:crypto';

import { UsageError } from '../../../src/errors';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  environment,
  runProgram,
  runtimeExecutable,
} from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  pathExists,
  readText,
  removePath,
  resolve,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import {
  defineRound,
  runRound,
  validateRound,
  type RoundDefinition,
} from '../../../src/rounds/index';
import { runScript } from '../../../src/usage';

/** Uma "CLI" que lista a pasta onde roda. */
class ListProvider implements Provider<string, string> {
  public readonly id = 'lista';

  public describe(): { name: string; model: string } {
    return { name: 'lista', model: 'roteiro' };
  }

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        "process.stdout.write('Vejo: ' + require('fs').readdirSync('.').filter((f) => f !== '.git').join(', '))",
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

const git = (root: string, ...args: string[]): Promise<string> =>
  runProgram(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=dev',
      '-c',
      'user.email=dev@exemplo',
      ...args,
    ],
    { timeoutMs: 30_000 },
  );

const project = resolve(import.meta.dir, '../../..');
const scratch = join(
  goiabaCacheDir(environment()),
  'rounds-exemplo',
  randomUUID(),
);
const repo = join(scratch, 'projeto-real');
const records = join(scratch, 'registros');
ensureDirectory(repo);
ensureDirectory(records);

/** Uma rodada que parte de `root`, na `tag`, com um agente que lista a pasta. */
const listing = (root: string): RoundDefinition =>
  defineRound({
    id: 'projeto-real',
    goal: 'O agente vê o projeto como na tag.',
    start: { git: { root, tag: 'rodada-base' } },
    actors: {
      dev: {
        provider: new ListProvider(),
        workspace: { type: 'bubblewrap', root },
      },
    },
    flow: [{ actor: 'dev', prompt: () => ['O que há aqui?'] }],
  });

await runScript(async () => {
  try {
    // Um repositório com um commit e a tag; e uma sobra de uma execução antiga.
    writeText(join(repo, 'app.ts'), 'export const versao = 1;\n');
    await git(repo, 'init', '-q');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'base');
    await git(repo, 'tag', 'rodada-base');
    writeText(join(repo, 'sobra.txt'), 'da última execução\n');

    const [file = ''] = await runRound(listing(repo), {
      dir: records,
      project,
    });
    const record = validateRound(JSON.parse(readText(file)));
    writeOut(
      `\npartida: tag ${String(record.start?.tag)}, fixture ${String(record.start?.fixture)}\n` +
        `disse: ${record.steps[0]?.said.join(' ') ?? ''}\n` +
        `sobra.txt ainda existe? ${pathExists(join(repo, 'sobra.txt')) ? 'sim' : 'não'}\n\n`,
    );

    // Uma pasta sem .git próprio, dentro do repositório: o git subiria até ele.
    const inside = join(repo, 'sem-git');
    ensureDirectory(inside);
    writeText(join(repo, 'pendente.txt'), 'não commitado\n');
    try {
      await runRound(listing(inside), { dir: records, project });
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      writeOut(`recusada: ${error.message.replaceAll(scratch, '…')}\n`);
    }
    writeOut(
      `pendente.txt continua? ${pathExists(join(repo, 'pendente.txt')) ? 'sim' : 'não'}\n`,
    );
  } finally {
    removePath(scratch);
  }
});
```

Saída:

```
Workspace no ponto de partida: rodada-base (609a96e)
Dev…
Vejo: app.ts

Rodada guardada em /home/dev/.cache/goiaba/rounds-exemplo/b489ad69-50d1-4810-b855-2bb2ca9eacb1/registros/2026-11-06T14-19-31.486Z.json

partida: tag rodada-base, fixture null
disse: Vejo: app.ts
sobra.txt ainda existe? não

recusada: A pasta da rodada (…/projeto-real/sem-git) não é a raiz de um repositório git: o git subiria até …/projeto-real. Rode numa pasta com o próprio .git.
pendente.txt continua? sim
```

- `fixture null`: a partida veio de um repositório, não de uma fixture.
- `pendente.txt`, um arquivo não commitado do repositório em volta, continua lá: a trava parou antes do reset.

### 7. Rodadas de verdade

As rodadas com modelos de verdade ficam em `rounds/definitions/` e rodam com `bun run rounds <id>`. Precisam do
`rounds.dir` configurado e, conforme o provider, do Ollama rodando com o modelo baixado ou das credenciais da CLI.

- [`ollama-product-owner.ts`](../../rounds/definitions/ollama-product-owner.ts): um agente local (Ollama) cria um
  arquivo a partir da fixture `site-vazio`, com uma política que libera escrita no workspace e poucos comandos.
- [`analise-programacao-revisao.ts`](../../rounds/definitions/analise-programacao-revisao.ts): analista, programador e
  revisor (Claude Code e Cursor) a partir da fixture `analise-base`, com a regra de que toda correção tem um teste.

Duas lições que essas rodadas já ensinaram:

- **Escrever não é só ter permissão de escrita.** A política tem duas portas: `filesystem` diz onde se pode escrever
  (a sandbox aplica) e `execution` diz quais comandos rodam (o hook do Goiaba aplica). Um `cat > arquivo << EOF` casa
  com `cat *`, mas tem redirecionamento: nenhuma regra libera um comando assim, e numa rodada ninguém aprova. A
  ferramenta de arquivo da CLI (o `Write` do Claude Code, o `apply_patch` do Codex) passa só pela regra de
  `filesystem`.
- **Modelos pequenos às vezes respondem com o conteúdo em vez de chamar a ferramenta.** Declare instruções
  conferíveis (`instructions`) para cada arquivo pedido: sem elas, a eficácia não vê que nada foi gravado.

[↑ topo](#topo)

## Regras do módulo

- **A rodada declara; o motor roda.** Nada de rodada entra no `runScript` nem no `Agent.run()`: o `runRound` compõe
  os agentes, e eles não sabem que estão numa rodada.
- **Registro e páginas só com o que o sistema registrou.** A única exceção é o `label`, texto de quem rodou. Nada é
  numerado pela ordem dos arquivos: um teste é o seu `id`, uma configuração é o começo do `configHash`.
- **Não medido é `null`, nunca `0`.** Um critério sem o que medir fica fora da média.
- **A pasta da rodada fica fora do projeto e tem o próprio git.** As travas não se desligam.
- **Caminhos do repositório são fixos; o que depende da máquina é configuração.** Só o `rounds.dir` é opção.
- **Mudou a rubrica, sobe `RUBRIC_VERSION`.** Os números ficam em `RUBRIC`, em `src/rounds/constants.ts`, cada um com o
  motivo.

[↑ topo](#topo)

## Exercícios

1. Copie o [Exemplo 2](#2-a-primeira-rodada) e acrescente `instructions: { dev: [{ check: { file: 'index.html',
contains: 'Olá' } }] }`. Rode e veja "Instruções do prompt" no registro. Troque `'Olá'` por `'Tchau'`: o que muda?
2. No [Exemplo 3](#3-dois-agentes-instruções-e-regras), dê ao analista `permissions` com escrita só em `notas/**`
   (`{ operations: ['write'], paths: ['/workspace/notas/**'] }`, junto do `read` em `/workspace/**`) e faça-o gravar
   em `notas/rascunho.txt`. A regra `readOnlyRespected` continua violada? Por quê?
3. Escreva uma regra própria, `noEmptyAnswer`, que reprova um passo cuja fala tem menos de 10 caracteres, e use-a no
   Exemplo 2 com uma resposta curta.
4. No [Exemplo 4](#4-as-notas), mude os tokens para `[1000, 1000, 1000]`. Que nota "Tokens novos" recebe a terceira
   execução, e por quê (veja a tabela da referência em `rounds/README.md`)?
5. Crie uma fixture `rounds/fixtures/meu-site/` com um `index.html` e uma rodada em `rounds/definitions/` que peça para
   o agente acrescentar um rodapé, com uma instrução `contains: '<footer'`. Rode com `bun run rounds <id>` e abra a
   rodada nas páginas.

[↑ topo](#topo)
