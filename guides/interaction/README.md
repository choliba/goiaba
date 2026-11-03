<a id="topo"></a>

# Módulo interaction: para que ele existe

Um agente **conversa**: pergunta, ouve a resposta, ouve o que a pessoa digita enquanto ele trabalha, pede uma escolha de uma tecla, mostra o que pensou e o que respondeu. O módulo `interaction` é **a conversa**, e ela não sabe por onde passa: um terminal, a tela cheia do TUI, um arquivo, um chat web.

O que é de cada forma de conversar fica **na frente**, num **adapter**, que traduz nos dois sentidos. A conversa recebe eventos que já não dizem de onde vieram, e mostra numa `Output`:

```
fonte              adapter (um por forma)              eventos                 Conversation (uma só)
─────────────      ──────────────────────────────      ─────────────────       ───────────────────────
teclado        →   teclas, linha, colagem, Ctrl+A  ┐
pipe           →   cada linha é uma mensagem       ├→  message, choice,    →  pede, espera, enfileira,
arquivo JSONL  →   cada linha é um evento          │   interrupt, command      entrega a quem perguntou
                                                   ┘
                   ←── Output do adapter  ←────────────────────────────────── write, stream, reasoning
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`Interaction`: o que o agente usa](#interaction-o-que-o-agente-usa)
  - [Os eventos e os pedidos](#os-eventos-e-os-pedidos)
  - [`InteractionAdapter`: o contrato do adapter](#interactionadapter-o-contrato-do-adapter)
  - [`Conversation`](#conversation)
- [Como funciona](#como-funciona)
  - [Três fluxos](#três-fluxos)
  - [A fila e o que passa à frente](#a-fila-e-o-que-passa-à-frente)
  - [Escolhas](#escolhas)
  - [Desistir de uma pergunta](#desistir-de-uma-pergunta)
  - [Pedidos que ninguém responde](#pedidos-que-ninguém-responde)
  - [O que se mostra, na ordem](#o-que-se-mostra-na-ordem)
- [Exemplos](#exemplos)
  - [1. Um adapter seu](#1-um-adapter-seu)
  - [2. O que passa à frente](#2-o-que-passa-à-frente)
  - [3. Escolher e desistir](#3-escolher-e-desistir)
  - [4. Pedidos sem resposta](#4-pedidos-sem-resposta)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo           | Papel                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `index.ts`        | o contrato `Interaction`, e o que o módulo exporta                       |
| `events.ts`       | os eventos que entram (`InputEvent`) e os pedidos (`InteractionRequest`) |
| `adapter.ts`      | o contrato `InteractionAdapter` e `PendingRequest`                       |
| `conversation.ts` | a `Conversation`, a única implementação de `Interaction`                 |
| `constants.ts`    | `DEFAULT_MAX_UNANSWERED_REQUESTS`                                        |

Os adapters moram em [`src/adapters`](../adapters/README.md): o stdio, o [TUI](../tui/README.md) e o JSONL.

[↑ topo](#topo)

## Interface

### `Interaction`: o que o agente usa

| Membro                             | O que faz                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ask(question, signal?, instant?)` | a próxima linha; onde der, uma tecla de `instant` numa linha vazia é a resposta sem Enter (`q`) |
| `listen(signal?)`                  | a próxima linha que chegou sem ser pedida (o que se digita enquanto o agente trabalha)          |
| `choose(keys, signal?)`            | uma das `keys`, com uma tecla onde der; `''` é o padrão (Enter)                                 |
| `write(text)`                      | uma mensagem inteira                                                                            |
| `stream(text)`                     | um pedaço da resposta, enquanto ela é escrita                                                   |
| `reasoning(text)`                  | um pedaço do que o modelo pensou, à parte da resposta                                           |
| `status(text)`                     | a linha de status (`⏳ pensando…`); `undefined` a apaga                                         |
| `error(text)`                      | um diagnóstico para quem roda o programa                                                        |
| `lineLength()`                     | colunas de uma linha, para tabelas                                                              |
| `close()`                          | encerra a conversa e o adapter                                                                  |

Alguns membros são opcionais no contrato, para quem escreve uma `Interaction` à mão (como os agentes em `agents/`); a `Conversation` tem todos.

### Os eventos e os pedidos

`InputEvent`, o que chega, já interpretado:

| Evento                      | De onde vem, por exemplo                   |
| --------------------------- | ------------------------------------------ |
| `{ type: 'message', text }` | uma linha enviada; uma linha de um arquivo |
| `{ type: 'choice', key }`   | a tecla de uma escolha (`''` é o padrão)   |
| `{ type: 'interrupt' }`     | Ctrl+C; `/exit` no TUI                     |
| `{ type: 'command', name }` | Ctrl+A é `approvals`                       |

`InteractionRequest`, o que a conversa pede ao adapter: `{ type: 'line', instant }` ou `{ type: 'choice', keys }`.

### `InteractionAdapter`: o contrato do adapter

| Membro             | O que faz                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `events()`         | tudo o que chega, pedido ou não, até a fonte acabar; lido uma vez, e só começa a ler quando é percorrido |
| `request(request)` | pede do jeito do adapter; devolve um `PendingRequest` (`cancel()`), ou `undefined` quando não sabe pedir |
| `output`           | a `Output` por onde o que se mostra sai                                                                  |
| `close()`          | para de ler e desfaz o que o adapter fez (o modo raw, uma tela)                                          |

### `Conversation`

`new Conversation(adapter, options?)`:

| Opção                   | O que faz                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `urgent(line)`          | as linhas que passam à frente das que esperam (o comando de aprovações)             |
| `onInterrupt()`         | o que um `interrupt` faz antes de a conversa fechar; por padrão, o Ctrl+C           |
| `maxUnansweredRequests` | o limite de pedidos sem resposta; `DEFAULT_MAX_UNANSWERED_REQUESTS` (20) por padrão |

O agente monta a dele com `agentConversation(adapter?)` (em `src/agent`): o adapter stdio com o Ctrl+A, e o comando de aprovações como urgente.

[↑ topo](#topo)

## Como funciona

### Três fluxos

1. **Pedido e resposta:** `ask` e `choose` pedem ao adapter e esperam o evento certo.
2. **O que chega sem ter sido pedido:** o que se digita enquanto o agente trabalha. Vai para uma fila, e o próximo `ask` ou `listen` o recebe.
3. **O que sai:** `write`, `stream`, `reasoning`, `status` e `error`, pela `Output` do adapter.

A resposta a um pedido chega pelo mesmo canal dos eventos não pedidos: é a `Conversation` que liga uma coisa à outra, do mesmo jeito para qualquer adapter.

### A fila e o que passa à frente

As linhas esperam na ordem em que chegaram. Duas coisas passam à frente: uma linha que `urgent` aceita, e um **comando**, que chega a quem lê como a linha `:nome` (Ctrl+A chega como `:approvals`).

### Escolhas

Num adapter que sabe pedir uma tecla (o stdio num terminal, o TUI), a escolha toma a próxima tecla, à frente da linha que está sendo digitada, e o adapter mostra a resposta. Num adapter que só tem linhas (um pipe, um arquivo), a primeira letra da próxima linha é a escolha, e a `Conversation` mostra a resposta.

### Desistir de uma pergunta

O `signal` de um `ask` cancela **só a espera** daquele pedido: a fonte continua aberta, e o que chegar depois fica para o próximo. Cancelar uma pergunta nunca fecha o teclado. Já o fim da fonte (EOF, Ctrl+D) recusa quem espera e quem vier depois.

### Pedidos que ninguém responde

Um adapter que não sabe pedir devolve `undefined`: o pedido é ignorado e logado, e a conversa segue, porque o que chega responde do mesmo jeito. Mas se os pedidos ignorados se acumulam **sem nada chegar no meio**, ninguém está lá para responder: passado o limite, perguntar de novo é um `UsageError`, em vez de esperar para sempre.

### O que se mostra, na ordem

O que se mostra sai na ordem em que foi pedido. Os pedaços de `stream` (e os de `reasoning`) vão juntos num `writeStream` da saída, até outra coisa ser mostrada, que espera por eles. Quando nada está sendo mostrado, um `write` sai na mesma chamada: um programa que escreve e termina não perde nada.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `guides/interaction/exemplos/` que roda como está, sem terminal: os adapters são feitos ali mesmo.

### 1. Um adapter seu

`guides/interaction/exemplos/1-adapter-proprio.ts`:

```ts
/**
 * Exemplo 1 do curso de interaction: uma conversa sobre um adapter seu. O
 * adapter só precisa entregar eventos e ter uma saída; a Conversation faz o
 * resto: pede, espera, guarda o que chega sem ter sido pedido e entrega na
 * ordem. Aqui os eventos vêm de uma lista, com uma pausa entre eles.
 */
import {
  Conversation,
  type InputEvent,
  type InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function scripted(events: readonly InputEvent[]): InteractionAdapter {
  return {
    events: async function* () {
      for (const event of events) {
        await pause(10);
        yield event;
      }
    },
    // Uma lista não sabe perguntar: o pedido é ignorado.
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const conversation = new Conversation(
  scripted([
    { type: 'message', text: 'oi' },
    { type: 'message', text: 'tudo bem?' },
    { type: 'message', text: 'tchau' },
  ]),
);

conversation.write('Olá! Diga algo.');
const first = await conversation.ask('');
conversation.write(`ouvi: ${first}`);
// As outras chegaram enquanto ninguém perguntava: esperaram na fila.
await pause(50);
conversation.write(`depois: ${await conversation.listen()}`);
conversation.write(`e: ${await conversation.listen()}`);
conversation.close();
```

Saída real:

```
Olá! Diga algo.
ouvi: oi
depois: tudo bem?
e: tchau
```

### 2. O que passa à frente

`guides/interaction/exemplos/2-prioridade.ts`:

```ts
/**
 * Exemplo 2 do curso de interaction: o que passa à frente. Uma linha que
 * quem montou diz ser urgente vai antes das que esperam; um comando também,
 * e chega a quem lê como a linha `:nome`. É assim que o Ctrl+A (o comando
 * `approvals`) abre as aprovações no meio de um turno.
 */
import {
  Conversation,
  type InputEvent,
  type InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

function list(events: readonly InputEvent[]): InteractionAdapter {
  return {
    events: async function* () {
      yield* events;
    },
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const conversation = new Conversation(
  list([
    { type: 'message', text: 'primeira' },
    { type: 'message', text: 'segunda' },
    { type: 'message', text: 'pare' },
    { type: 'command', name: 'approvals' },
  ]),
  { urgent: (line) => line === 'pare' },
);

const first = await conversation.listen();
conversation.write(`1: ${first}`);
// Enquanto ninguém pergunta, o resto chega e espera na fila.
await new Promise((resolve) => setTimeout(resolve, 10));
for (let order = 2; order <= 4; order += 1) {
  conversation.write(`${String(order)}: ${await conversation.listen()}`);
}
conversation.close();
```

Saída real:

```
1: primeira
2: :approvals
3: pare
4: segunda
```

O comando passou à frente de tudo, e a linha urgente, à frente da que já esperava.

### 3. Escolher e desistir

`guides/interaction/exemplos/3-escolha-e-cancelar.ts`:

```ts
/**
 * Exemplo 3 do curso de interaction: escolher e desistir. Um adapter que só
 * tem linhas responde uma escolha com a primeira letra da linha, e a
 * Conversation mostra a resposta. Desistir de uma pergunta (o signal) não
 * perde o que chegar depois: a linha fica para quem perguntar em seguida.
 */
import { OutputStream } from '../../../src/execute/stream';
import { Conversation, type InputEvent } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const incoming = new OutputStream<InputEvent>();
const conversation = new Conversation({
  events: () => incoming,
  request: () => undefined,
  output: stdioOutput,
  close: () => {
    incoming.close();
  },
});

conversation.write('Continuar? [s/n]');
const choice = conversation.choose(['s', 'n']);
incoming.publish({ type: 'message', text: 'Sim, pode' });
conversation.write(`escolheu: ${await choice}`);

const controller = new AbortController();
const asked = conversation.ask('', controller.signal);
controller.abort();
try {
  await asked;
} catch (error) {
  conversation.write(
    `a pergunta: ${error instanceof Error ? error.message : String(error)}`,
  );
}
incoming.publish({ type: 'message', text: 'chegou depois' });
conversation.write(`a próxima: ${await conversation.listen()}`);
conversation.close();
```

Saída real:

```
Continuar? [s/n]
s
escolheu: s
a pergunta: A entrada foi cancelada.
a próxima: chegou depois
```

### 4. Pedidos sem resposta

`guides/interaction/exemplos/4-sem-resposta.ts`:

```ts
/**
 * Exemplo 4 do curso de interaction: pedidos que ninguém responde. Cada
 * pedido que o adapter não pode fazer é logado; passado o limite, sem nada
 * chegar no meio, perguntar de novo é um UsageError, em vez de esperar
 * para sempre. O limite padrão é DEFAULT_MAX_UNANSWERED_REQUESTS.
 */
import { UsageError } from '../../../src/errors';
import { OutputStream } from '../../../src/execute/stream';
import {
  Conversation,
  DEFAULT_MAX_UNANSWERED_REQUESTS,
  type InputEvent,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const conversation = new Conversation(
  {
    // Nada chega (o stream nunca acaba), e o adapter não sabe perguntar.
    events: () => new OutputStream<InputEvent>(),
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  },
  { maxUnansweredRequests: 2 },
);

conversation.write(
  `padrão: ${String(DEFAULT_MAX_UNANSWERED_REQUESTS)}; aqui: 2`,
);
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort();
  }, 10);
  try {
    await conversation.ask('', controller.signal);
  } catch (error) {
    const kind = error instanceof UsageError ? 'UsageError' : 'desistiu';
    conversation.write(
      `tentativa ${String(attempt)}: ${kind}${error instanceof UsageError ? ` (${error.message})` : ''}`,
    );
  }
}
conversation.close();
```

Saída real:

```
padrão: 20; aqui: 2
tentativa 1: desistiu
tentativa 2: desistiu
tentativa 3: UsageError (A entrada não responde: 3 pedidos seguidos sem nada chegar. Verifique a fonte da conversa ou aumente maxUnansweredRequests.)
```

[↑ topo](#topo)

## Regras do módulo

- **A conversa não sabe por onde passa.** Nada de teclas, eco, telas ou arquivos aqui: isso é dos adapters.
- **Uma `Conversation` só.** Fila, prioridade, escolhas e o limite de pedidos valem para qualquer adapter; um adapter novo não reimplementa nada disso.
- **Quem monta diz o que é urgente.** A `Conversation` só aplica a regra que recebeu.
- **O adapter mostra a resposta de uma escolha** quando foi ele quem pediu a tecla; a `Conversation` só mostra quando o adapter não sabia pedir.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 1, troque `ask` por `listen` na primeira pergunta. Muda alguma coisa? Por quê?
2. **Médio.** No Exemplo 2, mande também um `{ type: 'interrupt' }` no fim da lista, e passe um `onInterrupt` que escreva "parou". O que acontece com quem estava esperando?
3. **Avançado.** Escreva um adapter que sabe pedir (devolve um `PendingRequest`) e, a cada `request`, escreve na saída o que foi pedido (`linha` ou `escolha`). Use-o com um `choose` e um `ask` cancelado: quantas vezes `cancel()` é chamado?

[↑ topo](#topo)
