<a id="topo"></a>

# Módulo context: acompanhar quem está executando

Enquanto um agente trabalha, várias partes do Goiaba produzem eventos e logs: o executor, a sandbox, a rede, as
aprovações. O módulo `context` dá a essas partes o contexto de **qual agente está ativo e em qual execução**, sem
passar esses dados por todos os métodos.

O contexto acompanha o fluxo assíncrono. Assim, um evento emitido depois de um `await` continua identificado com o
agente que iniciou aquele trabalho. Fora de um contexto de agente, `currentContext()` devolve um objeto vazio.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [Tipos](#tipos)
  - [Funções](#funções)
- [Como funciona](#como-funciona)
  - [O contexto assíncrono](#o-contexto-assíncrono)
  - [Execuções aninhadas](#execuções-aninhadas)
  - [Quem usa os dados](#quem-usa-os-dados)
  - [Não confundir com `ApprovalScope`](#não-confundir-com-approvalscope)
- [Exemplos](#exemplos)
  - [1. Fora e dentro do agente](#1-fora-e-dentro-do-agente)
  - [2. Depois de um await](#2-depois-de-um-await)
  - [3. Agentes aninhados](#3-agentes-aninhados)
  - [4. Contexto num evento](#4-contexto-num-evento)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo                | Papel                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `src/context/index.ts` | O módulo inteiro: `AgentContext`, `RunContext`, `runAs`, `currentRun` e `currentContext`. |

O módulo usa `AsyncLocalStorage` para manter os dados no fluxo assíncrono e `randomUUID` para criar um ID de
execução quando não há um ID atual para reaproveitar. Ele importa somente o tipo `ProviderDescription`.

[↑ topo](#topo)

## Interface

### Tipos

| Tipo           | Campos                             | Significado                                                                         |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `AgentContext` | `name`, `provider?`                | Quem está executando. `provider` descreve o provider, o modelo e, quando há, a CLI. |
| `RunContext`   | `agent?`, `run?`, `agentProvider?` | Os campos opcionais que eventos e logs anexam aos seus próprios dados.              |

`AgentContext` é a entrada de `runAs`. `RunContext` é a saída de `currentContext` e a parte de contexto que eventos
e logs carregam.

### Funções

| Função                     | O que faz                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `runAs(agent, work, run?)` | Executa `work` no contexto do agente e devolve o valor que `work` devolve. O terceiro argumento permite informar o ID da execução. |
| `currentRun(name)`         | Devolve o ID atual somente se o agente no contexto tiver esse `name`; caso contrário, devolve `undefined`.                         |
| `currentContext()`         | Devolve `{}` fora de um agente; dentro, devolve `agent`, `run` e `agentProvider` quando disponível.                                |

`runAs` reutiliza o ID atual quando o mesmo agente já está ativo. Se não houver esse contexto, cria um UUID. Um
`run` explícito tem prioridade sobre os dois comportamentos.

[↑ topo](#topo)

## Como funciona

### O contexto assíncrono

`runAs(agent, work)` configura o `AsyncLocalStorage` enquanto chama `work`. O contexto acompanha as operações
assíncronas iniciadas dentro desse callback, incluindo promessas e temporizadores. Duas tarefas simultâneas podem
ter contextos diferentes sem sobrescrever o contexto uma da outra.

O contexto não é uma variável global que fica definida até alguém limpá-la. Depois que o callback termina, o código
que o chamou volta ao contexto anterior — ou a nenhum contexto.

### Execuções aninhadas

Uma execução é um `Agent.run()`. Chamadas aninhadas de `runAs` com o mesmo nome reutilizam seu `run`, para que os
eventos sigam ligados à mesma execução. Entrar em outro agente cria um `run` novo. Quando o callback aninhado acaba,
o contexto anterior volta a valer.

O terceiro argumento existe para quem precisa reentrar no mesmo contexto em mais de uma chamada. O próprio agente
usa isso ao avançar um iterador assíncrono: cada `next()` é chamado dentro do mesmo `run`, embora cada passo seja uma
chamada separada.

### Quem usa os dados

O módulo `context` não grava nem publica nada. Ele só fornece metadados:

| Consumidor   | Como usa o contexto                                            |
| ------------ | -------------------------------------------------------------- |
| `src/events` | Acrescenta `agent`, `run` e `agentProvider` ao evento emitido. |
| `src/logger` | Acrescenta os mesmos campos aos registros.                     |
| `src/agent`  | Abre o contexto ao iniciar e ao avançar cada turno do agente.  |

O produtor do evento ainda define `source` e `type`; o logger ainda recebe o tipo e os dados de quem registrou. O
contexto identifica **quem** e **qual execução**, sem acoplar esses módulos ao agente.

### Não confundir com `ApprovalScope`

O contexto deste módulo é **de execução**: quem está rodando agora. `ApprovalScope`, exportado pelo store, é outra
coisa: `'once'`, `'session'`, `'workspace'` ou `'deny'`, por quanto tempo uma aprovação vale. Os dois não
compartilham tipo nem responsabilidade. O módulo se chamava `scope`, e o nome mudou para `context` justamente para
não confundir os dois.

[↑ topo](#topo)

## Exemplos

Os exemplos completos ficam em `agents/meus-testes/context-exemplos/`. Eles rodam com Bun e não precisam de provider
instalado nem de rede.

### 1. Fora e dentro do agente

Fora de `runAs`, o contexto está vazio. Dentro, há o nome, o provider se informado e um ID de execução.

`agents/meus-testes/context-exemplos/1-fora-e-dentro.ts`:

```ts
/** Exemplo 1 do curso de context: consultar o contexto antes e durante um agente. */
import { writeOut } from '../../../src/output/terminal';
import { runAs, currentContext } from '../../../src/context/index';

writeOut(`fora: ${JSON.stringify(currentContext())}\n`);

runAs({ name: 'revisor', provider: { name: 'claude', model: 'haiku' } }, () => {
  const context = currentContext();
  writeOut(
    `dentro: ${context.agent} / ${context.agentProvider?.name}, execução: ${context.run === undefined ? 'não' : 'sim'}\n`,
  );
});

writeOut(`depois: ${JSON.stringify(currentContext())}\n`);
```

```text
fora: {}
dentro: revisor / claude, execução: sim
depois: {}
```

### 2. Depois de um await

O contexto permanece disponível depois de uma espera assíncrona iniciada dentro de `runAs`.

`agents/meus-testes/context-exemplos/2-assincrono.ts`:

```ts
/** Exemplo 2 do curso de context: manter o contexto depois de um await. */
import { writeOut } from '../../../src/output/terminal';
import { runAs, currentContext } from '../../../src/context/index';

async function consultar(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  writeOut(`depois do await: ${currentContext().agent}\n`);
}

await runAs({ name: 'relatorio' }, consultar);
```

```text
depois do await: relatorio
```

### 3. Agentes aninhados

O agente com o mesmo nome herda o `run`; um agente de outro nome ganha um `run` próprio. Ao retornar, o contexto
do coordenador volta.

`agents/meus-testes/context-exemplos/3-aninhado.ts`:

```ts
/** Exemplo 3 do curso de context: herdar e trocar o contexto de agente. */
import { writeOut } from '../../../src/output/terminal';
import { runAs, currentContext } from '../../../src/context/index';

runAs({ name: 'coordenador' }, () => {
  const parentRun = currentContext().run;

  runAs({ name: 'coordenador' }, () => {
    writeOut(`mesma execução: ${currentContext().run === parentRun}\n`);
  });

  runAs({ name: 'pesquisador' }, () => {
    writeOut(
      `agente filho: ${currentContext().agent}; execução própria: ${currentContext().run !== parentRun}\n`,
    );
  });

  writeOut(`contexto restaurado: ${currentContext().agent}\n`);
});
```

```text
mesma execução: true
agente filho: pesquisador; execução própria: true
contexto restaurado: coordenador
```

### 4. Contexto num evento

Um consumidor de eventos recebe o contexto que estava ativo no momento da emissão. O produtor não precisa conhecer
o agente.

`agents/meus-testes/context-exemplos/4-evento.ts`:

```ts
/** Exemplo 4 do curso de context: enriquecer um evento com o contexto atual. */
import {
  createConsumer,
  createProducer,
  type GoiabaEvent,
} from '../../../src/events/index';
import { writeOut } from '../../../src/output/terminal';
import { runAs } from '../../../src/context/index';

const received: GoiabaEvent[] = [];
const consumer = createConsumer((event) => received.push(event));
consumer.subscribe('importacao');

const imports = createProducer('importacao');

runAs({ name: 'construtor', provider: { name: 'codex', model: 'local' } }, () =>
  imports.emit({ type: 'arquivo_lido', path: 'src/app.ts' }),
);

const event = received.at(0);
if (event !== undefined) {
  writeOut(`${event.source}/${event.type}: ${event.agent}\n`);
  writeOut(
    `provider: ${event.agentProvider?.name}/${event.agentProvider?.model}\n`,
  );
  writeOut(`execução presente: ${event.run !== undefined}\n`);
}

consumer.unsubscribeAll();
```

```text
importacao/arquivo_lido: construtor
provider: codex/local
execução presente: true
```

[↑ topo](#topo)

## Regras do módulo

- Use `runAs` para estabelecer o contexto em torno do trabalho que pertence a um agente.
- Leia os campos com `currentContext`; não crie outro armazenamento global para o nome ou o ID da execução.
- Use `currentRun(name)` somente quando precisar saber se aquele agente específico já está ativo.
- Reutilize o mesmo `run` ao reentrar no contexto da mesma execução em chamadas separadas.
- Não misture o contexto deste módulo com `ApprovalScope`, que define a duração de aprovações.
- O módulo só fornece metadados; eventos, logs e persistência continuam com seus próprios donos.

[↑ topo](#topo)

## Exercícios

1. Chame `currentContext()` antes, dentro e depois de `runAs`. Quais campos existem em cada ponto?
2. Passe um objeto `provider` e compare `agentProvider` com o resultado sem esse campo.
3. Crie dois `runAs` de nomes diferentes dentro de `Promise.all` e confira que cada tarefa lê seu próprio nome após um `await`.
4. Passe um ID explícito como terceiro argumento de `runAs`; compare o valor com `currentContext().run` dentro do callback.
5. Emita um evento dentro de `runAs` e leia `agent`, `run` e `agentProvider` no consumidor.

[↑ topo](#topo)
