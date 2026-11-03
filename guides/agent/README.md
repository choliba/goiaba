<a id="topo"></a>

# Módulo agent: para que ele existe

Um **agente** é uma CLI de código (Claude Code, Codex, Cursor, um modelo local pelo Ollama) trabalhando numa tarefa, dentro de uma sandbox, conversando com alguém. O módulo `agent` é **quem junta as peças**, e nenhuma delas depende dele:

| Peça          | De onde vem                                   | O que diz                                 |
| ------------- | --------------------------------------------- | ----------------------------------------- |
| `provider`    | [`src/providers`](../providers/README.md)     | qual CLI roda, e como ler o que ela diz   |
| `workspace`   | [`src/workspace`](../workspace/README.md)     | onde ela roda (bubblewrap ou Docker)      |
| `permissions` | [`src/policy`](../policy/README.md)           | o que ela pode fazer                      |
| `interaction` | [`src/interaction`](../interaction/README.md) | com quem ela conversa                     |
| `store`       | `src/store`                                   | o que fica lembrado (sessões, aprovações) |

Um turno, do começo ao fim:

```
mensagem ─▶ provider.createCommand ─▶ Executor (na sandbox) ─▶ provider.parseOutput ─▶ eventos
                                                                                          │
             conversa (write, stream, reasoning, status) ◀── agente ──▶ subscribe e log ◀─┘
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`Agent`: as opções](#agent-as-opções)
  - [`Agent`: os métodos](#agent-os-métodos)
  - [`AgentOutput`: o que `subscribe` recebe](#agentoutput-o-que-subscribe-recebe)
  - [A conversa do agente: `agentConversation`](#a-conversa-do-agente-agentconversation)
  - [Peças que dá para usar sozinhas](#peças-que-dá-para-usar-sozinhas)
- [Como funciona](#como-funciona)
  - [Um turno](#um-turno)
  - [Tarefa ou conversa](#tarefa-ou-conversa)
  - [Sessão e retomada](#sessão-e-retomada)
  - [O que aparece na conversa](#o-que-aparece-na-conversa)
  - [O que se digita durante um turno](#o-que-se-digita-durante-um-turno)
  - [Permissões e aprovações](#permissões-e-aprovações)
  - [Parar](#parar)
  - [Um agente por workspace](#um-agente-por-workspace)
  - [O que vai para o log e para o `subscribe`](#o-que-vai-para-o-log-e-para-o-subscribe)
- [Exemplos](#exemplos)
  - [1. O menor agente](#1-o-menor-agente)
  - [2. Uma conversa](#2-uma-conversa)
  - [3. Acompanhar o agente](#3-acompanhar-o-agente)
  - [4. A resposta em pedaços](#4-a-resposta-em-pedaços)
  - [5. Parar](#5-parar)
  - [6. Uma política que o provider não aplica](#6-uma-política-que-o-provider-não-aplica)
  - [7. Agentes de verdade](#7-agentes-de-verdade)
- [Os agentes de `agents/`](#os-agentes-de-agents)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo           | Papel                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `agent.ts`        | a classe `Agent`, `agentConversation`, `AGENT_SHORTCUTS`, `listenInput` e `watchThinking` |
| `types.ts`        | `AgentOptions`, `AgentStatus`, `AgentProvider`, `AgentSubscriber`                         |
| `output.ts`       | `AgentOutput`: um evento do agente, como o `subscribe` o recebe                           |
| `run-provider.ts` | `runProvider`: um turno do provider no `Executor`                                         |
| `lock.ts`         | `WorkspaceLock`: um agente por workspace                                                  |
| `constants.ts`    | `APPROVAL_POLL_MS`, `THINKING_TICK_MS`                                                    |

[↑ topo](#topo)

## Interface

### `Agent`: as opções

`new Agent(options)`:

| Opção            | Obrigatória | O que é                                                                                        |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `name`           | sim         | o nome do agente: vai em todo registro de log e evento                                         |
| `prompt`         | sim         | a tarefa, mandada no primeiro turno                                                            |
| `provider`       | sim         | qual CLI roda                                                                                  |
| `workspace`      | sim         | onde ela roda                                                                                  |
| `permissions`    | não         | a política (`AgentPolicy`); sem ela, a sandbox sem regras extras                               |
| `interaction`    | não         | com quem conversa; `agentConversation()` (o stdio, com Ctrl+A) por padrão                      |
| `approve`        | não         | quem decide os comandos que a política deixa em aberto; pergunta na conversa por padrão        |
| `signal`         | não         | para o agente; o do `runScript` (o Ctrl+C) por padrão                                          |
| `conversation`   | não         | `true` (padrão): espera a próxima mensagem depois de cada turno; `false`: uma tarefa só        |
| `resume`         | não         | `true` (padrão): continua sozinho uma tarefa interrompida ou com algo aprovado para ela        |
| `store`          | não         | onde ficam sessões, decisões e aprovações; o banco do `goiaba.config.ts` por padrão            |
| `subscribe`      | não         | funções que recebem cada evento do agente, na hora                                             |
| `executor`       | não         | um `Executor` próprio (ou `output`, um `OutputDispatcher` para os eventos crus; nunca os dois) |
| `approvalPollMs` | não         | de quanto em quanto tempo procura aprovações novas; `APPROVAL_POLL_MS` (1000)                  |
| `thinkingTickMs` | não         | o intervalo dos eventos `thinking` enquanto o modelo está calado; `THINKING_TICK_MS` (2000)    |

Uma categoria da política que o provider não sabe aplicar é recusada **ao criar** o agente, com um `UsageError` ([Exemplo 6](#6-uma-política-que-o-provider-não-aplica)).

### `Agent`: os métodos

| Método      | O que faz                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `run()`     | começa (ou continua) a conversa; enquanto ela roda, devolve a mesma execução                       |
| `pause()`   | interrompe o turno e deixa a sandbox e o gate abertos; `run()` continua                            |
| `stop()`    | interrompe e fecha a sandbox e o gate; a sessão fica aberta no banco, e o próximo `run()` continua |
| `reset()`   | para e abandona as sessões abertas: o próximo `run()` começa do zero                               |
| `destroy()` | para, abandona as sessões e solta tudo: o agente não pode mais ser usado                           |
| `status()`  | `idle`, `running`, `paused`, `stopped` ou `destroyed`                                              |

E as propriedades `name`, `prompt`, `provider` e `workspace`.

### `AgentOutput`: o que `subscribe` recebe

| Método     | O que devolve                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `type()`   | o que aconteceu: `input`, `session`, `output`, `ask`, `answer`, `message`, `status`, `thinking`, `reasoning`, `usage`, `error`… |
| `data()`   | o que veio com o evento                                                                                                         |
| `ts()`     | quando, em ISO                                                                                                                  |
| `agent()`  | o próprio agente (`name`, `prompt`, `provider`, `workspace`…)                                                                   |
| `toJSON()` | o evento inteiro                                                                                                                |

### A conversa do agente: `agentConversation`

`agentConversation(adapter?)` monta a `Conversation` que um agente usa: o adapter stdio com `AGENT_SHORTCUTS` (Ctrl+A manda o comando `approvals`) por padrão, e o comando de aprovações passando à frente do que espera. Para outra forma de conversar, troque o adapter:

```ts
agentConversation(new TuiAdapter({ shortcuts: AGENT_SHORTCUTS })); // tela cheia
agentConversation(new JsonlAdapter({ path: 'conversa.jsonl' })); // um arquivo
```

### Peças que dá para usar sozinhas

| Peça                                 | O que faz                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `runProvider(provider, executor, …)` | um turno: monta o comando, roda no `Executor` e devolve os eventos do provider    |
| `listenInput(listen, signal, map?)`  | ouve o que se digita durante um turno, guardando o que chega até alguém esperar   |
| `watchThinking(onPhase, options?)`   | as fases de "pensando" (`start`, `tick`, `end`) enquanto o modelo trabalha calado |
| `WorkspaceLock`                      | o lock de um workspace (veja [Um agente por workspace](#um-agente-por-workspace)) |

[↑ topo](#topo)

## Como funciona

### Um turno

1. O agente manda a mensagem ao provider, que monta o comando da CLI (`createCommand`).
2. O `Executor` roda o comando **dentro do workspace** (a sandbox), com as permissões já traduzidas para a CLI.
3. O provider lê o que a CLI escreve (`parseOutput`) e devolve eventos: `session`, `partial`, `reasoning`, `output`, `ask`, `tool`.
4. O agente leva cada evento à conversa, ao `subscribe` e ao log.

### Tarefa ou conversa

Com `conversation: false`, o agente termina quando a CLI termina e não pergunta nada. Com `conversation: true` (o padrão), depois de cada turno ele espera a próxima mensagem; termina quando a entrada acaba (Ctrl+D, o fim de um pipe ou de uma lista) ou quando é parado. Numa conversa, o provider precisa dizer qual é a sessão (um evento `session`): o turno seguinte continua nela.

### Sessão e retomada

As sessões ficam no `store`. Com `resume: true`, um `run()` com o mesmo prompt continua a tarefa interrompida (pelo Ctrl+C, por um `stop()`) ou com algo aprovado para ela desde então. Se a CLI já esqueceu a sessão, o agente avisa e começa de novo, sem falhar. `reset()` e `destroy()` abandonam as sessões abertas.

### O que aparece na conversa

| O agente recebe             | A conversa mostra                                                        |
| --------------------------- | ------------------------------------------------------------------------ |
| o turno começou             | a linha de status `⏳ pensando…` (sem status, uma mensagem, uma vez)     |
| `reasoning`                 | o raciocínio, à parte da resposta (`reasoning`)                          |
| `partial`                   | cada pedaço da resposta, na hora (`stream`)                              |
| `output` depois dos pedaços | nada a mais: a resposta já está na tela                                  |
| `output` sem pedaços        | a resposta inteira (`write`)                                             |
| `ask`                       | a pergunta, e espera a resposta                                          |
| `tool`                      | o status muda (`⏳ rodando em background…`); a ferramenta vai para o log |

### O que se digita durante um turno

O que se digita enquanto a CLI trabalha não se perde: vai para o próximo turno (ou, numa CLI que aceita mensagens no meio do turno, para o mesmo processo). O Ctrl+A abre as aprovações na hora, à frente das mensagens que esperam.

### Permissões e aprovações

A política vai em `permissions`. O agente a passa ao workspace (o que a sandbox aplica: arquivos e rede) e ao provider (o que a CLI aplica: execução, web). Um comando que a política deixa em aberto (`require_approval`) é decidido pelo `approve`, que por padrão pergunta na conversa (`[u/s/w/n]`). Os detalhes estão no curso de [policy](../policy/README.md).

### Parar

| Como                           | O que acontece                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+C (dentro de `runScript`) | o turno para: a CLI recebe SIGTERM (e SIGKILL depois de `KILL_GRACE_MS`), a sandbox fecha; um segundo Ctrl+C força a saída |
| `signal`                       | o mesmo, pelo código (um tempo limite, um botão)                                                                           |
| `pause()`                      | o turno para, mas a sandbox e o gate ficam abertos                                                                         |
| `stop()`                       | o turno para e a sandbox fecha; a sessão continua no próximo `run()`                                                       |
| `reset()`, `destroy()`         | além de parar, abandonam as sessões; `destroy()` não deixa usar o agente de novo                                           |

### Um agente por workspace

Dois agentes no mesmo `root` brigariam pelos mesmos arquivos. O `WorkspaceLock` deixa um programa só por vez em cada workspace: um agente de outro programa ainda vivo é recusado com um `UsageError` que diz quem está lá (nome, pid, desde quando). O lock de um programa que morreu sem soltar é tomado; agentes do mesmo programa compartilham o lock.

### O que vai para o log e para o `subscribe`

Todo registro de um agente diz quem ele é: `gen_ai.agent.name`, o provider, o modelo e a CLI. O `subscribe` recebe o que acontece na conversa (`input`, `output`, `status`, `thinking`, `usage`…); o log recebe isso e, com `debug: true`, os detalhes técnicos (comandos, sandbox, ferramentas). Os eventos de `thinking` a cada `thinkingTickMs` são só um relógio: vão ao `subscribe`, não ao log.

[↑ topo](#topo)

## Exemplos

Os exemplos 1 a 6 são arquivos de `guides/agent/exemplos/` que rodam como estão, **sem modelo nem rede**: cada um traz um provider pequeno, escrito ali mesmo, que usa o próprio `bun` como "CLI". O workspace é um `bubblewrap` numa pasta temporária, apagada no fim: precisam do bubblewrap instalado.

### 1. O menor agente

`guides/agent/exemplos/1-uma-tarefa.ts`:

```ts
/**
 * Exemplo 1 do curso do agente: o menor agente. Um agente junta um provider
 * (qual CLI roda), um workspace (onde) e uma conversa (com quem fala). Aqui
 * o provider é de mentira, para rodar sem modelo nem rede: a "CLI" é o
 * próprio bun, que responde o que recebeu em maiúsculas.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma "CLI" que lê o pedido no stdin e responde em maiúsculas. */
class ShoutProvider implements Provider<string, string> {
  public readonly id = 'grito';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'process.stdout.write((await Bun.stdin.text()).toUpperCase())',
      ],
      input,
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

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'gritador',
      prompt: 'diga oi',
      provider: new ShoutProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      // Uma tarefa: o agente termina quando o provider responde.
      conversation: false,
    }).run();
  } finally {
    removePath(root);
  }
});
```

Saída real:

```
DIGA OI
```

### 2. Uma conversa

`guides/agent/exemplos/2-conversa.ts`:

```ts
/**
 * Exemplo 2 do curso do agente: uma conversa. Com `conversation: true` (o
 * padrão), cada mensagem que chega é um turno: o agente responde e espera a
 * próxima. Aqui a conversa vem de uma lista (um adapter feito no exemplo), e
 * o agente para quando ela acaba. A "CLI" responde quantas letras ouviu.
 */
import { randomUUID } from 'node:crypto';

import { agentConversation, Agent } from '../../../src/agent/agent';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type {
  InputEvent,
  InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class CountProvider implements Provider<string, string> {
  public readonly id = 'contador';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'const t = (await Bun.stdin.text()).trim(); process.stdout.write(`"${t}" tem ${t.length} letras`)',
      ],
      input,
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    // Numa conversa, o provider diz qual é a sessão: o turno seguinte a usa.
    yield { type: 'session', id: 'conversa-de-exemplo' };
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

/** As mensagens de quem conversa, uma depois da outra; depois, o fim. */
function messages(lines: readonly string[]): InteractionAdapter {
  return {
    events: async function* (): AsyncGenerator<InputEvent> {
      for (const text of lines) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await stdioOutput.write(`› ${text}`);
        yield { type: 'message', text };
      }
    },
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'contador',
      prompt: 'oi',
      provider: new CountProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      interaction: agentConversation(messages(['goiaba', 'tudo bem?'])),
      resume: false,
    }).run();
  } finally {
    removePath(root);
  }
});
```

Saída real:

```
"oi" tem 2 letras
› goiaba
"goiaba" tem 6 letras
› tudo bem?
"tudo bem?" tem 9 letras
```

O primeiro turno é o `prompt`; cada mensagem depois é um turno. Quando a lista acaba, o agente termina.

### 3. Acompanhar o agente

`guides/agent/exemplos/3-acompanhar.ts`:

```ts
/**
 * Exemplo 3 do curso do agente: acompanhar o que o agente faz. Cada função
 * de `subscribe` recebe um AgentOutput por evento, na hora: o tipo
 * (`type()`), o que veio com ele (`data()`), quando (`ts()`) e o agente
 * (`agent()`). É assim que um painel ou um site acompanha um agente.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import type { AgentOutput } from '../../../src/agent/output';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { writeOut } from '../../../src/output/stdio';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class EchoProvider implements Provider<string, string> {
  public readonly id = 'eco';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'process.stdout.write(`eco: ${await Bun.stdin.text()}`)',
      ],
      input,
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

/** Mostra cada evento numa linha: o tipo e o que veio com ele. */
function painel(event: AgentOutput): void {
  writeOut(
    `[${event.agent().name}] ${event.type().padEnd(8)} ${JSON.stringify(event.data())}\n`,
  );
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'eco',
      prompt: 'olá',
      provider: new EchoProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      conversation: false,
      // Uma conversa que não mostra nada, e sem linha de status (por isso
      // o "pensando" vira uma mensagem): só o painel aparece.
      interaction: {
        ask: () => Promise.reject(new Error('nada a perguntar')),
        write: () => undefined,
      },
      subscribe: [painel],
    }).run();
  } finally {
    removePath(root);
  }
});
```

Saída real:

```
[eco] input    {"value":"olá"}
[eco] status   {"text":"⏳ pensando…"}
[eco] message  {"text":"⏳ pensando…"}
[eco] thinking {"phase":"start","seconds":0}
[eco] output   {"value":"eco: olá"}
[eco] status   {"text":null}
[eco] thinking {"phase":"end","seconds":0}
[eco] message  {"text":"eco: olá"}
```

Esta conversa não tem linha de status, então o "pensando" virou uma mensagem; numa conversa com status (a de um terminal), ele só reescreve a linha.

### 4. A resposta em pedaços

`guides/agent/exemplos/4-resposta-em-pedacos.ts`:

```ts
/**
 * Exemplo 4 do curso do agente: a resposta em pedaços, e o raciocínio à
 * parte. Um provider que lê o modelo enquanto ele escreve manda `reasoning`
 * (o que o modelo pensou) e `partial` (cada pedaço da resposta), e depois a
 * resposta inteira (`output`). O agente leva os pedaços à conversa assim
 * que chegam; a saída daqui marca cada stream, para ver como ele chegou.
 */
import { randomUUID } from 'node:crypto';

import { agentConversation, Agent } from '../../../src/agent/agent';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type { InputEvent } from '../../../src/interaction/index';
import { completeOutput } from '../../../src/output/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma "CLI" que escreve, linha a linha, o que pensou e a resposta. */
class WriterProvider implements Provider<string, string> {
  public readonly id = 'escritor';

  public createCommand(): ProgramCommand {
    const lines = [
      'pensa:o pedido é simples',
      'parte:Uma goiaba ',
      'parte:é uma fruta.',
    ];
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        `for (const line of ${JSON.stringify(lines)}) { console.log(line); await Bun.sleep(50); }`,
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let answer = '';
    for await (const { channel, chunk } of output) {
      if (channel !== 'stdout') continue;
      for (const line of chunk.split('\n').filter((text) => text !== '')) {
        const [kind, text = ''] = line.split(/:(.*)/s);
        if (kind === 'pensa') yield { type: 'reasoning', text };
        if (kind === 'parte') {
          answer += text;
          yield { type: 'partial', text };
        }
      }
    }
    yield { type: 'output', value: answer };
  }
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'escritor',
      prompt: 'o que é uma goiaba?',
      provider: new WriterProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      conversation: false,
      interaction: agentConversation({
        events: async function* (): AsyncGenerator<InputEvent> {
          // Uma tarefa: ninguém digita nada.
        },
        request: () => undefined,
        output: completeOutput({
          write: (text, kind = 'message') => {
            writeOut(`${kind}: ${JSON.stringify(text)}\n`);
          },
          writeStream: async (pieces, kind = 'message') => {
            const got: string[] = [];
            for await (const piece of pieces) got.push(piece);
            writeOut(
              `${kind} em pedaços: ${got.map((piece) => JSON.stringify(piece)).join(' + ')}\n`,
            );
          },
        }),
        close: () => undefined,
      }),
    }).run();
  } finally {
    removePath(root);
  }
});
```

Saída real:

```
reasoning em pedaços: "o pedido é simples"
message em pedaços: "Uma goiaba " + "é uma fruta." + "\n"
```

O raciocínio e a resposta chegaram como dois streams, cada um com o seu tipo; a resposta inteira (`output`), que veio depois, não foi mostrada de novo.

### 5. Parar

`guides/agent/exemplos/5-parar.ts`:

```ts
/**
 * Exemplo 5 do curso do agente: parar. `status()` diz em que pé o agente
 * está. `stop()` interrompe o turno (o CLI recebe SIGTERM) e fecha a
 * sandbox; `destroy()` encerra de vez: o agente não pode mais ser usado.
 * Aqui a "CLI" demora 5 segundos, e paramos o agente antes disso.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class SlowProvider implements Provider<string, string> {
  public readonly id = 'devagar';

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: ['-e', 'await Bun.sleep(5000); console.log("pronto")'],
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

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  const agent = new Agent({
    name: 'devagar',
    prompt: 'demore',
    provider: new SlowProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    conversation: false,
    interaction: {
      ask: () => Promise.reject(new Error('nada a perguntar')),
      write: () => undefined,
    },
  });

  try {
    writeOut(`antes:        ${agent.status()}\n`);
    const running = agent.run();
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeOut(`rodando:      ${agent.status()}\n`);

    const startedAt = performance.now();
    await agent.stop();
    await running;
    const seconds = (performance.now() - startedAt) / 1000;
    writeOut(
      `depois do stop: ${agent.status()} (${seconds < 1 ? 'em menos de 1 s' : 'demorou'}, sem esperar os 5 s)\n`,
    );

    await agent.destroy();
    writeOut(`destroy:      ${agent.status()}\n`);
    try {
      await agent.run();
    } catch (error) {
      writeOut(
        `run() de novo: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  } finally {
    removePath(root);
  }
});
```

Saída real:

```
antes:        idle
rodando:      running
depois do stop: stopped (em menos de 1 s, sem esperar os 5 s)
destroy:      destroyed
run() de novo: O agente devagar foi destruído.
```

### 6. Uma política que o provider não aplica

`guides/agent/exemplos/6-politica-recusada.ts`:

```ts
/**
 * Exemplo 6 do curso do agente: uma política que o provider não aplica é
 * recusada na hora, ao criar o agente, com um UsageError que diz o porquê.
 * Nada roda: melhor do que um agente que parece protegido e não está. As
 * categorias web, execution e communication dependem do provider (a CLI as
 * aplica); este provider de exemplo não sabe aplicar nenhuma.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { UsageError } from '../../../src/errors';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { Workspace } from '../../../src/workspace/index';

class PlainProvider implements Provider<string, string> {
  public readonly id = 'simples';

  public createCommand(input: string): ProgramCommand {
    return { executable: runtimeExecutable(), arguments: ['-e', ''], input };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { chunk } of output)
      yield { type: 'output', value: chunk };
  }
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

try {
  const agent = new Agent({
    name: 'simples',
    prompt: 'rode os testes',
    provider: new PlainProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    permissions: {
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
        execution: [{ commands: ['bun test'] }],
      },
    },
  });
  writeOut(`o agente ${agent.name} foi criado\n`);
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  writeOut(`recusado: ${error.message}\n`);
} finally {
  removePath(root);
}
```

Saída real:

```
recusado: O provider simples não aplica a categoria execution.
```

### 7. Agentes de verdade

Com um modelo, o agente é o mesmo: só o provider muda. `agents/ollama.ts` roda um agente num modelo local do Ollama, pela CLI do Claude Code ou do Codex, conversando no terminal; `agents/tui.ts` faz o mesmo em tela cheia:

```
bun agents/ollama.ts claude
bun agents/tui.ts codex
```

Precisam do Ollama rodando com o modelo do arquivo, da CLI escolhida instalada e, o segundo, de um terminal.

[↑ topo](#topo)

## Os agentes de `agents/`

A pasta `agents/` tem os agentes do projeto, que rodam com um modelo de verdade:

| Arquivo                                             | O que mostra                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ollama.ts`                                         | um agente num modelo local, pela CLI escolhida no argumento (`claude` ou `codex`); `bun run ollama`                       |
| `tui.ts`                                            | o mesmo agente em tela cheia; `bun run tui`                                                                               |
| `ollama.codex.ts`                                   | um agente com cada entrada e saída explicada (`ask`, `listen`, `choose`, `approve`, `subscribe`…); `bun run ollama:codex` |
| `claude-haiku-5-5.claude.ts`, `gpt-6-luna.codex.ts` | a mesma montagem, num modelo na nuvem (Claude Code, Codex)                                                                |
| `goiaba.anget.ts`                                   | um agente com um `subscribe` que mostra o "pensando"                                                                      |
| `center.listener.ts`                                | um `subscribe` que recebe todos os eventos                                                                                |
| `api.ts`                                            | vários agentes numa API HTTP, com eventos ao vivo (o site usa esta API)                                                   |
| `instructor.ts`                                     | o Instructor, que escreve cursos (`bun run generate-guides <modulo>`)                                                     |
| `permissions.ts`                                    | `todasAsPermissoes`, uma política com todas as opções, comentada                                                          |

[↑ topo](#topo)

## Regras do módulo

- **O agente junta, não faz.** Processos rodam pelo `Executor`, a conversa passa pela `Interaction`, as permissões vêm da `AgentPolicy`, a sandbox é do `Workspace`: o agente não toca no terminal, no `process` nem no disco por conta própria.
- **Nada aplicado pela metade.** Uma categoria da política que o provider não aplica é recusada ao criar o agente.
- **Quem observa não age.** Uma função de `subscribe` só observa: chamar `run()` nela começaria o agente de novo a cada evento.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, mude o provider para responder a mensagem de trás para a frente. Mais alguma coisa precisa mudar?
2. **Médio.** Escreva uma função de `subscribe` que conte os turnos (eventos `input` e `answer`) e mostre o total quando o agente termina. Use-a no Exemplo 2.
3. **Avançado.** Monte o Exemplo 2 com um `JsonlAdapter` no lugar da lista, e escreva um segundo programa que acrescente mensagens ao arquivo enquanto o agente roda. Como o agente fica sabendo que a conversa acabou?

[↑ topo](#topo)
