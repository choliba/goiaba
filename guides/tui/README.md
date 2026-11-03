<a id="topo"></a>

# TUI: a conversa em tela cheia

O TUI é **um adapter**: mais uma forma de conversar, como o stdio (linha a linha) e o arquivo JSONL (veja o curso de [adapters](../adapters/README.md)). A [conversa](../interaction/README.md) é a mesma `Conversation` de sempre: ela não sabe que está numa tela cheia. O `TuiAdapter` recebe as teclas, desenha a conversa e devolve só eventos.

A tela tem três partes:

```
┌──────────────────────────────┐
│ Oi! Em que posso ajudar?     │  as mensagens: as últimas que cabem
│                              │
│ › quanto é 2 + 2?            │  › o que você mandou
│ 💭 uma conta simples         │  💭 o raciocínio (some com /thinking)
│ 2 + 2 é 4.                   │
│ ⏳ pensando…          /help  │  o status
│ › obri                       │  o que você está digitando
└──────────────────────────────┘
```

O TUI não lê o stdin nem escreve na tela por conta própria: as teclas chegam pelo `src/input` (o único leitor do stdin) e passam pela mesma `Typing` do stdio; o desenho sai pelo `writeOut` (`src/output/stdio.ts`), o único escritor do stdout. Não depende de biblioteca nenhuma.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`TuiAdapter`](#tuiadapter)
  - [`TuiScreen` e `ttyScreen`](#tuiscreen-e-ttyscreen)
  - [O cálculo da tela](#o-cálculo-da-tela)
- [Como funciona](#como-funciona)
  - [O que se digita](#o-que-se-digita)
  - [O que se mostra](#o-que-se-mostra)
  - [O desenho](#o-desenho)
  - [A rolagem](#a-rolagem)
  - [Os comandos](#os-comandos)
  - [Entrar e sair da tela](#entrar-e-sair-da-tela)
- [Exemplos](#exemplos)
  - [1. O cálculo da tela](#1-o-cálculo-da-tela)
  - [2. Uma conversa numa tela de texto](#2-uma-conversa-numa-tela-de-texto)
  - [3. Os comandos e a rolagem ficam no TUI](#3-os-comandos-e-a-rolagem-ficam-no-tui)
  - [4. Um agente no TUI](#4-um-agente-no-tui)
- [Regras](#regras)
- [Exercícios](#exercícios)

## Os arquivos

Em `src/adapters/tui/`:

| Arquivo     | Papel                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `index.ts`  | o `TuiAdapter`, o `ttyScreen` (o terminal como tela) e os tipos `TuiScreen` e `TuiAdapterOptions` |
| `layout.ts` | o cálculo da tela, sem efeito nenhum: `frame`, `wrap`, `displayWidth` e `transcript`              |

[↑ topo](#topo)

## Interface

### `TuiAdapter`

`new TuiAdapter(options?)`, um `InteractionAdapter`:

| Opção          | O que é                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `shortcuts`    | teclas que mandam um comando (`AGENT_SHORTCUTS`: Ctrl+A abre as aprovações)        |
| `screen`       | onde desenha (`TuiScreen`); o terminal por padrão (`ttyScreen()`)                  |
| `source`       | de onde lê as teclas (`StdioSource`); o stdin por padrão                           |
| `frameDelayMs` | o intervalo entre redesenhos enquanto o texto chega; `DEFAULT_FRAME_DELAY_MS` (16) |

Um agente no TUI: `agentConversation(new TuiAdapter({ shortcuts: AGENT_SHORTCUTS }))`.

### `TuiScreen` e `ttyScreen`

| Membro                | O que faz                                                  |
| --------------------- | ---------------------------------------------------------- |
| `rows()`, `columns()` | o tamanho da tela                                          |
| `enter()`             | toma uma tela própria (a tela alternativa do terminal)     |
| `leave(text)`         | devolve a tela, deixando `text` (a conversa) no terminal   |
| `draw(text)`          | desenha um quadro inteiro (ou manda um ajuste ao terminal) |
| `onResize?(listener)` | avisa quando a tela muda de tamanho; devolve como parar    |

`ttyScreen()` é o terminal como tela. Sem um terminal (num pipe, numa redireção), ele recusa na hora, com um `UsageError`: nada seria visto.

### O cálculo da tela

| Função                    | O que faz                                                                        |
| ------------------------- | -------------------------------------------------------------------------------- |
| `frame(entries, options)` | as linhas da tela: as últimas mensagens que cabem, o status e a linha de entrada |
| `wrap(text, columns)`     | o texto quebrado em linhas, por palavras onde der                                |
| `displayWidth(text)`      | quantas colunas o texto ocupa (emoji e caracteres largos ocupam duas)            |
| `transcript(entries)`     | a conversa como texto simples, para o terminal depois de sair da tela            |

[↑ topo](#topo)

## Como funciona

### O que se digita

As teclas são lidas em raw e passam pela `Typing`, a mesma do stdio: a linha sendo digitada, o apagar, a colagem, a escolha de uma tecla, os atalhos, o Ctrl+C. A diferença é como a linha aparece: no stdio, como eco do terminal; no TUI, a `Typing` avisa a linha nova (`onLine`) e o TUI a desenha embaixo, junto do resto.

### O que se mostra

A conversa é uma lista de entradas. A `Output` do TUI acrescenta uma entrada a cada `write`, e cada `writeStream` vai juntando os pedaços a uma entrada enquanto eles chegam. O raciocínio é uma entrada própria, e por isso o `/thinking` consegue escondê-lo sem tocar na resposta. O que você manda aparece como `› …`, e a resposta de uma escolha também.

### O desenho

A cada mudança, o TUI agenda um redesenho (no máximo um a cada 16 ms, porque um stream manda muitos pedaços) e desenha **o quadro inteiro**: as mensagens que cabem, quebradas pela largura, o status com `/help` à direita e a linha de entrada, com o cursor no fim. Quando o terminal muda de tamanho, ele redesenha.

### A rolagem

| Tecla                        | O que faz                           |
| ---------------------------- | ----------------------------------- |
| ↑ / ↓ (e a rodinha do mouse) | uma linha para trás / para a frente |
| PageUp / PageDown            | uma página                          |
| End                          | volta ao fim                        |

Enquanto a tela está rolada, o status mostra quantas linhas há abaixo. Ao mandar uma mensagem, a tela volta ao fim. As teclas chegam da `Typing` (`onSequence`): nunca viram texto, e nunca saem do TUI.

### Os comandos

Uma linha começando com `/` é do TUI, não da conversa:

| Comando     | O que faz                                       |
| ----------- | ----------------------------------------------- |
| `/help`     | lista os comandos                               |
| `/thinking` | mostra ou esconde o raciocínio                  |
| `/clear`    | limpa a tela (a conversa com o modelo continua) |
| `/exit`     | encerra, como Ctrl+C (um `interrupt`)           |

Um comando desconhecido é recusado, com a ajuda, e não vai à conversa.

### Entrar e sair da tela

O TUI entra na tela na primeira coisa que mostra ou pede, e sai no `close()`, e também quando o programa termina no meio (`onProgramExit`). Ao sair, a conversa fica impressa no terminal normal, e o que já estava no terminal antes volta.

[↑ topo](#topo)

## Exemplos

Os exemplos 1 a 3 são arquivos de `guides/tui/exemplos/` que rodam como estão, sem terminal: a tela e o teclado são feitos ali mesmo. O 4 precisa de um terminal e do Ollama.

### 1. O cálculo da tela

`guides/tui/exemplos/1-layout.ts`:

```ts
/**
 * Exemplo 1 do curso do TUI: o cálculo da tela. `frame` não desenha nada:
 * recebe as entradas da conversa e o tamanho da tela e devolve as linhas.
 * Quebra por palavras, conta um emoji como duas colunas e mostra só as
 * últimas mensagens que cabem.
 */
import { displayWidth, frame } from '../../../src/adapters/tui/index';
import { writeOut } from '../../../src/output/stdio';

const { lines } = frame(
  [
    { kind: 'text', text: 'Oi! Em que posso ajudar?', open: false },
    { kind: 'user', text: 'quanto é 2 + 2?', open: false },
    { kind: 'reasoning', text: 'uma conta simples', open: false },
    {
      kind: 'text',
      text: 'Dois mais dois é quatro, e a conta é exata.',
      open: false,
    },
  ],
  {
    rows: 9,
    columns: 30,
    status: '⏳ pensando…',
    input: 'obri',
    showReasoning: true,
  },
);

for (const line of lines) writeOut(`|${line}\n`);
writeOut(`\nlargura de "💭 oi": ${String(displayWidth('💭 oi'))} colunas\n`);
```

Saída real (cada linha da tela depois de um `|`):

```
|
|› quanto é 2 + 2?
|
|💭 uma conta simples
|
|Dois mais dois é quatro, e a
|conta é exata.
|⏳ pensando…             /help
|› obri

largura de "💭 oi": 5 colunas
```

### 2. Uma conversa numa tela de texto

`guides/tui/exemplos/2-conversa.ts`:

```ts
/**
 * Exemplo 2 do curso do TUI: uma conversa numa tela de texto. O TuiAdapter
 * desenha numa `TuiScreen` (aqui, uma que guarda o último quadro) e lê as
 * teclas de uma `StdioSource` (aqui, uma lista). A Conversation é a mesma
 * de sempre: o TUI é só mais um adapter.
 */
import type { StdioSource } from '../../../src/adapters/stdio/index';
import { TuiAdapter, type TuiScreen } from '../../../src/adapters/tui/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { writeOut } from '../../../src/output/stdio';

/** Uma tela de 10×36 que guarda o último quadro, sem os estilos. */
function textScreen(): TuiScreen & { readonly lines: () => string[] } {
  let last = '';
  return {
    rows: () => 10,
    columns: () => 36,
    enter: () => undefined,
    leave: () => undefined,
    draw: (text) => {
      if (text.startsWith('\u001b[H')) last = text;
    },
    lines: () =>
      last
        // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split('\r\n')
        .map((line) => line.trimEnd()),
  };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));
const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const screen = textScreen();
const conversation = new Conversation(
  new TuiAdapter({ screen, source: keyboard, frameDelayMs: 0 }),
);

conversation.write('Oi! Em que posso ajudar?');
const asked = conversation.ask('');
keys.publish('quanto é 2 + 2?\r');
await asked;
conversation.status('⏳ pensando…');
conversation.reasoning('uma conta ');
conversation.reasoning('simples');
conversation.stream('Dois mais dois ');
conversation.stream('é quatro.');
conversation.status(undefined);
void conversation.ask('').catch(() => undefined);
keys.publish('obri');
await tick();

for (const line of screen.lines()) writeOut(`|${line}\n`);
conversation.close();
```

Saída real:

```
|
|Oi! Em que posso ajudar?
|
|› quanto é 2 + 2?
|
|💭 uma conta simples
|
|Dois mais dois é quatro.
|                               /help
|› obri
```

### 3. Os comandos e a rolagem ficam no TUI

`guides/tui/exemplos/3-comandos.ts`:

```ts
/**
 * Exemplo 3 do curso do TUI: os comandos e a rolagem ficam no TUI. `/help`,
 * `/thinking` e um comando desconhecido nunca chegam à conversa; a próxima
 * linha que chega é a primeira que não começa com `/`. PageUp rola as
 * mensagens para trás, e o status mostra quantas linhas ficaram abaixo.
 */
import type { StdioSource } from '../../../src/adapters/stdio/index';
import { TuiAdapter, type TuiScreen } from '../../../src/adapters/tui/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { writeOut } from '../../../src/output/stdio';

function textScreen(): TuiScreen & { readonly lines: () => string[] } {
  let last = '';
  return {
    rows: () => 12,
    columns: () => 50,
    enter: () => undefined,
    leave: () => undefined,
    draw: (text) => {
      if (text.startsWith('\u001b[H')) last = text;
    },
    lines: () =>
      last
        // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split('\r\n')
        .map((line) => line.trimEnd()),
  };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));
const show = (title: string): void => {
  writeOut(`--- ${title}\n`);
  for (const line of screen.lines()) writeOut(`|${line}\n`);
};
const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const screen = textScreen();
const conversation = new Conversation(
  new TuiAdapter({ screen, source: keyboard, frameDelayMs: 0 }),
);

conversation.reasoning('pensei bastante');
const asked = conversation.ask('');
keys.publish('/thinking\r/xyz\r/help\rolá\r');
writeOut(`a conversa recebeu: ${JSON.stringify(await asked)}\n`);
await tick();
show('depois dos comandos');

keys.publish('\u001b[5~'); // PageUp
await tick();
show('depois do PageUp');
conversation.close();
```

Saída real:

```
a conversa recebeu: "olá"
--- depois dos comandos
|
|Comandos:
|  /thinking  mostra ou esconde o raciocínio do
|modelo
|  /clear     limpa a tela (a conversa continua)
|  /exit      encerra (o mesmo que Ctrl+C)
|  /help      esta ajuda
|Ctrl+A abre as aprovações.
|
|› olá
|                                             /help
|›
--- depois do PageUp
|💭 pensou (/thinking mostra)
|
|Raciocínio escondido.
|
|Comando desconhecido: /xyz. Veja /help.
|
|Comandos:
|  /thinking  mostra ou esconde o raciocínio do
|modelo
|  /clear     limpa a tela (a conversa continua)
|↓ 5 linha(s) abaixo (End volta ao fim)       /help
|›
```

### 4. Um agente no TUI

`agents/tui.ts` roda um agente no Ollama, em tela cheia, escolhendo a CLI pelo argumento:

```
bun agents/tui.ts claude
bun agents/tui.ts codex
```

A parte que monta a conversa:

```ts
const tui = agentConversation(new TuiAdapter({ shortcuts: AGENT_SHORTCUTS }));
```

Precisa de um terminal (sem ele, o `ttyScreen` recusa) e do Ollama rodando com o modelo do arquivo.

[↑ topo](#topo)

## Regras

**Ninguém deve:**

- **Ler o teclado por fora do `src/input`.** As teclas chegam por uma `StdioSource`; um segundo leitor do teclado já travou um agente.
- **Escrever na tela por fora do `stdio.ts`.** O `ttyScreen` usa o `writeOut` e as funções de tela de lá.
- **Usar uma biblioteca de tela cheia** (Ink, blessed…): elas leem e escrevem no terminal por conta própria, passando por cima dos dois donos.
- **Fazer a conversa saber que está num TUI.** Rolagem, comandos com `/` e o desenho ficam no adapter; para fora, só eventos.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, troque a tela para 5 linhas. Quais mensagens continuam aparecendo, e por quê?
2. **Médio.** Escreva uma `TuiScreen` que conte quantos quadros foram desenhados. Mande 100 pedaços com `stream` e descubra quantos redesenhos aconteceram. O que muda com `frameDelayMs: 0`?
3. **Avançado.** Acrescente um comando `/save <arquivo>` que grave a conversa (o `transcript`) num arquivo. Por que o arquivo deve ser gravado pelo `src/filesystem`, e não pelo TUI? E por que a mensagem "Conversa salva em …" deve ser uma entrada `note`, e não um `write`?

[↑ topo](#topo)
