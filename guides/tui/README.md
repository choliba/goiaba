<a id="topo"></a>

# Módulo tui: a conversa em tela cheia

O `src/tui` é **mais uma forma de conversar** com quem usa o programa, como a `TerminalInteraction` (linha a linha no terminal) e o arquivo do `goiaba-json`. Ele implementa a mesma `Interaction`: o agente não sabe que está numa tela cheia. Ele entrega a resposta, o raciocínio e o status, e o `tui` decide como desenhar.

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

O `tui` não lê o teclado nem escreve na tela por conta própria: lê pelo `StdinReader` (`src/input`), o único leitor do teclado, e escreve pelo `writeOut` (`src/output/terminal.ts`), o único escritor da tela. Não depende de biblioteca nenhuma.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`TuiInteraction`](#tuiinteraction)
  - [`TuiScreen` e `terminalScreen`](#tuiscreen-e-terminalscreen)
  - [`TuiInput`](#tuiinput)
  - [O cálculo da tela: `frame`, `wrap`, `displayWidth`, `transcript`](#o-cálculo-da-tela-frame-wrap-displaywidth-transcript)
  - [O que mudou fora do módulo](#o-que-mudou-fora-do-módulo)
- [Como funciona](#como-funciona)
  - [A entrada: o eco do que se digita](#a-entrada-o-eco-do-que-se-digita)
  - [A conversa: entradas, stream e raciocínio](#a-conversa-entradas-stream-e-raciocínio)
  - [O desenho](#o-desenho)
  - [A rolagem](#a-rolagem)
  - [Os comandos](#os-comandos)
  - [Entrar e sair da tela](#entrar-e-sair-da-tela)
- [Exemplos](#exemplos)
  - [1. O cálculo da tela](#1-o-cálculo-da-tela)
  - [2. Uma conversa numa tela de texto](#2-uma-conversa-numa-tela-de-texto)
  - [3. Os comandos ficam no TUI](#3-os-comandos-ficam-no-tui)
  - [4. Um agente no TUI](#4-um-agente-no-tui)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo     | Papel                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`  | A `TuiInteraction` (a conversa), o `terminalScreen` (o terminal como tela) e os tipos `TuiScreen`, `TuiInput`, `TuiOptions`.                                   |
| `layout.ts` | O cálculo da tela, sem efeito nenhum: o quadro (`frame`), a quebra de linha (`wrap`), a largura na tela (`displayWidth`) e a conversa em texto (`transcript`). |

[↑ topo](#topo)

## Interface

### `TuiInteraction`

```ts
new TuiInteraction(options?: TuiOptions)
```

| Opção                 | O que é                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen`              | onde desenha (`TuiScreen`); o terminal por padrão (`terminalScreen()`)                                                                               |
| `input`               | o que lê, a partir de para onde vão o eco e as teclas que não são texto: `({ echo, sequence }) => TuiInput`; um `StdinReader` no terminal por padrão |
| `shortcuts`, `urgent` | os mesmos do `StdinReader` (o `Ctrl+A` das aprovações vem no `AGENT_TERMINAL`)                                                                       |
| `frameDelayMs`        | o intervalo entre redesenhos enquanto o texto chega (16 ms)                                                                                          |

É uma `Interaction`:

| Método                                                 | No TUI                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `ask(question, signal?, instant?)` e `listen(signal?)` | a próxima linha digitada, depois de rodar os comandos com `/`; ela aparece como `› …` |
| `choose(keys, signal?)`                                | uma tecla (as aprovações)                                                             |
| `write(text)`                                          | uma mensagem inteira                                                                  |
| `stream(text)`                                         | um pedaço de texto: junta-se à mensagem que está sendo escrita                        |
| `reasoning(text)`                                      | um pedaço do raciocínio, com `💭`, separado da resposta                               |
| `status(text)`                                         | a linha de status (`⏳ pensando…`); `undefined` apaga                                 |
| `width()`                                              | as colunas da tela                                                                    |
| `close()`                                              | sai da tela e deixa a conversa impressa no terminal                                   |

### `TuiScreen` e `terminalScreen`

```ts
interface TuiScreen {
  rows(): number;
  columns(): number;
  enter(): void; // toma uma tela própria
  leave(text: string): void; // devolve a tela, deixando `text` (a conversa)
  draw(text: string): void; // desenha um quadro inteiro
  onResize?(listener: () => void): () => void;
}
```

`terminalScreen()` é o terminal: a tela alternativa, o `writeOut` e o aviso de redimensionamento. Sem um terminal (um pipe, um redirecionamento), ele recusa na hora com um `UsageError`, antes de qualquer coisa rodar.

### `TuiInput`

```ts
type TuiInput = Pick<StdinReader, 'next' | 'choose' | 'close'>;
```

O que o TUI lê. No terminal, um `StdinReader`; num teste, qualquer objeto com esses três métodos. A função `input` recebe também os `TuiInputHandlers`: o `echo` (o eco do que se digita) e o `sequence` (as teclas que não são texto, como ↑ e PageUp), para a entrada repassar ao TUI.

### O cálculo da tela: `frame`, `wrap`, `displayWidth`, `transcript`

| Função                                                            | O que devolve                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `frame(entries, { rows, columns, status, input, showReasoning })` | o quadro: `lines` (as linhas, sem estilo) e `text` (o que vai ao terminal) |
| `wrap(text, columns)`                                             | o texto em linhas de no máximo `columns`, quebrando por palavras           |
| `displayWidth(text)`                                              | as colunas que o texto ocupa: emoji e caracteres largos ocupam duas        |
| `transcript(entries)`                                             | a conversa em texto, para o terminal depois de sair da tela                |

Uma `Entry` é `{ kind: 'user' | 'text' | 'reasoning' | 'note', text, open }`. `open` diz que ela ainda está sendo escrita.

### O que mudou fora do módulo

- **`src/output/terminal.ts`**: `terminalRows()`, `onTerminalResize(listener)`, `enterFullScreen()` e `leaveFullScreen()`. Continua sendo o único escritor da tela.
- **`src/input`**: o `KeyDecoder` aceita uma função que recebe as sequências que não são texto (setas, PageUp…), e o `StdinReader` ganha a opção `onSequence`. Antes elas eram descartadas; continuam sem virar tecla.
- **`terminal.ts`**: ao entrar na tela cheia, liga o modo em que a rodinha do mouse manda ↑ e ↓ (`?1007h`). Assim ela rola sem o TUI capturar o mouse, e dá para selecionar texto.
- **`Interaction`**: o método opcional `reasoning(text)`. O agente o usa quando a interação o tem; quem não o tem recebe o raciocínio como texto, depois de `💭`, como antes.

[↑ topo](#topo)

## Como funciona

### A entrada: o eco do que se digita

O `StdinReader` já recebe uma função `write`, para onde vai o eco do que se digita: as letras, o apagar (`\b \b`) e o Enter. O TUI passa a **sua** função e guarda o que está sendo digitado. Nada vai direto para a tela: o TUI desenha a linha de entrada ele mesmo, embaixo, junto do resto. A edição (apagar, colar) continua com o `StdinReader`. Quando a linha é enviada, o TUI a recebe pelo `ask` ou pelo `listen` e a tira da linha de entrada.

### A conversa: entradas, stream e raciocínio

A conversa é uma lista de entradas. `write` acrescenta uma mensagem inteira; `stream` e `reasoning` juntam o pedaço à entrada que está sendo escrita, se for do mesmo tipo, ou começam uma nova. O raciocínio fica numa entrada própria, e por isso o `/thinking` consegue escondê-lo sem tocar na resposta.

### O desenho

A cada mudança, o TUI agenda um redesenho (no máximo um a cada 16 ms, porque um stream manda muitos pedaços) e desenha **o quadro inteiro**: as mensagens que cabem, quebradas pela largura, o status com `/help` à direita e a linha de entrada, com o cursor no fim. A largura conta emoji e caracteres largos como duas colunas. Quando o terminal muda de tamanho, ele redesenha.

### A rolagem

| Tecla                        | O que faz                           |
| ---------------------------- | ----------------------------------- |
| ↑ / ↓ (e a rodinha do mouse) | uma linha para trás / para a frente |
| PageUp / PageDown            | uma página                          |
| End                          | volta ao fim                        |

Enquanto a tela está rolada, o status mostra quantas linhas há abaixo. Ao mandar uma mensagem, a tela volta ao fim. As teclas chegam pela opção `onSequence` do `StdinReader`: o TUI não lê o teclado por conta própria.

### Os comandos

Uma linha começando com `/` é do TUI, não do agente:

| Comando     | O que faz                                       |
| ----------- | ----------------------------------------------- |
| `/help`     | lista os comandos                               |
| `/thinking` | mostra ou esconde o raciocínio                  |
| `/clear`    | limpa a tela (a conversa com o modelo continua) |
| `/exit`     | encerra, como Ctrl+C                            |

Um comando desconhecido é recusado, com a ajuda, e não vai ao agente.

### Entrar e sair da tela

O TUI entra na tela na primeira leitura e sai no `close()`. O agente chama `close()` no fim de cada execução, inclusive com Ctrl+C e com erro. Ao sair, a conversa fica impressa no terminal normal, e o que já estava no terminal antes volta.

[↑ topo](#topo)

## Exemplos

Os exemplos 1 a 3 rodam sem terminal e sem modelo: usam uma **tela de texto** (um `TuiScreen` que guarda o último quadro) e uma entrada que entrega linhas prontas. A saída mostra cada linha do quadro depois de um `|`: é o que o terminal mostraria.

### 1. O cálculo da tela

`agents/meus-testes/tui-exemplos/1-layout.ts`:

```ts
/** Exemplo 1 do curso de tui: o cálculo da tela, sem tela nenhuma. */
import { displayWidth, frame, wrap } from '../../../src/tui/index';
import { writeOut } from '../../../src/output/terminal';

writeOut(`${JSON.stringify(wrap('o mar azul sob o céu', 10))}\n`);
writeOut(`largura de "💭 oi": ${String(displayWidth('💭 oi'))}\n\n`);

const { lines } = frame(
  [
    { kind: 'text', text: 'Oi! Em que posso ajudar?', open: false },
    { kind: 'user', text: 'quanto é 2 + 2?', open: false },
    { kind: 'reasoning', text: 'conta simples', open: false },
    { kind: 'text', text: '4', open: false },
  ],
  {
    rows: 8,
    columns: 30,
    status: '⏳ pensando…',
    input: 'obri',
    showReasoning: true,
  },
);
for (const line of lines) writeOut(`|${line}\n`);
```

Saída real:

```
["o mar azul","sob o céu"]
largura de "💭 oi": 5

|
|› quanto é 2 + 2?
|
|💭 conta simples
|
|4
|⏳ pensando…             /help
|› obri
```

Com 8 linhas, sobram 6 para as mensagens. A primeira ("Oi! Em que posso ajudar?") não coube e ficou de fora: a tela mostra as últimas.

### 2. Uma conversa numa tela de texto

`agents/meus-testes/tui-exemplos/2-conversa.ts`:

```ts
/** Exemplo 2 do curso de tui: uma conversa numa tela de texto. */
import { TuiInteraction, type TuiScreen } from '../../../src/tui/index';
import { writeOut } from '../../../src/output/terminal';

/** Uma tela de 9 linhas por 36 colunas que guarda o último quadro. */
let last = '';
const screen: TuiScreen = {
  rows: () => 9,
  columns: () => 36,
  enter: () => writeOut('[entrou na tela]\n'),
  leave: (conversation) => writeOut(`[saiu da tela]\n${conversation}\n`),
  draw: (text) => {
    last = text;
  },
};

/** O que "você digita": uma linha por leitura. */
const typed = ['quanto é 2 + 2?'];
const tui = new TuiInteraction({
  screen,
  frameDelayMs: 0,
  input: () => ({
    next: () => Promise.resolve(typed.shift() ?? ''),
    choose: () => Promise.resolve(''),
    close: () => undefined,
  }),
});

tui.write('Oi! Em que posso ajudar?');
const question = await tui.ask('');
tui.status('⏳ pensando…');
tui.reasoning('uma conta ');
tui.reasoning('simples');
tui.stream('2 + 2 ');
tui.stream('é 4.');
tui.status(undefined);
await new Promise((resolve) => setTimeout(resolve, 5));

writeOut(`a resposta do ask: ${JSON.stringify(question)}\n`);
// oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
const plain = last.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
for (const line of plain.split('\r\n')) writeOut(`|${line.trimEnd()}\n`);
tui.close();
```

Saída real:

```
[entrou na tela]
a resposta do ask: "quanto é 2 + 2?"
|Oi! Em que posso ajudar?
|
|› quanto é 2 + 2?
|
|💭 uma conta simples
|
|2 + 2 é 4.
|                               /help
|›
[saiu da tela]
Oi! Em que posso ajudar?

› quanto é 2 + 2?

💭 uma conta simples

2 + 2 é 4.
```

- Os dois pedaços de raciocínio viraram uma linha, `💭 uma conta simples`, e os dois de texto viraram `2 + 2 é 4.`.
- Ao sair (`close`), a conversa fica no terminal, sem os estilos.

### 3. Os comandos ficam no TUI

`agents/meus-testes/tui-exemplos/3-comandos.ts`:

```ts
/** Exemplo 3 do curso de tui: os comandos com / ficam no TUI. */
import { TuiInteraction, type TuiScreen } from '../../../src/tui/index';
import { writeOut } from '../../../src/output/terminal';

let last = '';
const screen: TuiScreen = {
  rows: () => 16,
  columns: () => 56,
  enter: () => undefined,
  leave: () => undefined,
  draw: (text) => {
    last = text;
  },
};

/** /help, /thinking e um comando que não existe, antes da mensagem. */
const typed = ['/help', '/thinking', '/desfazer', 'continue'];
const tui = new TuiInteraction({
  screen,
  frameDelayMs: 0,
  input: () => ({
    next: () => Promise.resolve(typed.shift() ?? ''),
    choose: () => Promise.resolve(''),
    close: () => undefined,
  }),
});

tui.reasoning('pensei bastante antes');
const message = await tui.ask('');
await new Promise((resolve) => setTimeout(resolve, 5));

writeOut(`o agente recebeu só: ${JSON.stringify(message)}\n`);
// oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
const plain = last.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
for (const line of plain.split('\r\n')) writeOut(`|${line.trimEnd()}\n`);
```

Saída real:

```
o agente recebeu só: "continue"
|💭 pensou (/thinking mostra)
|
|Comandos:
|  /thinking  mostra ou esconde o raciocínio do modelo
|  /clear     limpa a tela (a conversa continua)
|  /exit      encerra (o mesmo que Ctrl+C)
|  /help      esta ajuda
|Ctrl+A abre as aprovações.
|
|Raciocínio escondido.
|
|Comando desconhecido: /desfazer. Veja /help.
|
|› continue
|                                                   /help
|›
```

Das quatro linhas digitadas, o agente recebeu só a última: `/help`, `/thinking` e `/desfazer` ficaram no TUI.

### 4. Um agente no TUI

`agents/tui.ts`:

```ts
import {
  AGENT_TERMINAL,
  Agent,
  ensureDirectory,
  humanApprover,
  join,
  OllamaProvider,
  runScript,
  TuiInteraction,
  UsageError,
  Workspace,
  type OllamaCli,
} from '../src/index';
import { currentDirectory, programArguments } from '../src/execute/process';
import { todasAsPermissoes } from './permissions';

/**
 * The local Ollama agent on a full screen (the TUI): the messages on top,
 * the status line and what you type at the bottom. Only the CLI changes:
 *
 *   bun agents/tui.ts claude
 *   bun agents/tui.ts codex
 *
 * /help lists the TUI's commands; Ctrl+A opens the approvals; Ctrl+C ends it.
 */
const MODEL = 'qwen3.5:4b';

/** Which CLI: the first argument. */
function chosenCli(): OllamaCli {
  const cli = programArguments().at(0);
  if (cli === 'claude' || cli === 'codex') return cli;
  throw new UsageError(
    `CLI desconhecida: ${cli ?? '(nenhuma)'}. Use: bun agents/tui.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const root = join(
    currentDirectory(),
    'storage',
    'workspaces',
    `agente-tui-${cli}`,
  );
  ensureDirectory(root);
  const tui = new TuiInteraction(AGENT_TERMINAL);

  await new Agent({
    resume: false,
    name: `agente-tui-${cli}`,
    prompt: 'Diga oi em uma linha e pergunte em que pode ajudar.',
    provider: new OllamaProvider({ cli, model: MODEL }),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    permissions: todasAsPermissoes,
    interaction: tui,
    approve: humanApprover(tui, signal),
    signal,
    conversation: true,
  }).run();
});
```

Para rodar, ele precisa de um terminal e do Ollama com o `qwen3.5:4b`: `bun agents/tui.ts codex` (ou `claude`). Sem terminal, recusa na hora:

```
$ echo | bun agents/tui.ts codex
O TUI precisa de um terminal: rode o programa direto, sem pipe nem redirecionamento.
```

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- Desenhar a conversa em tela cheia.

**Ninguém deve:**

- **Ler o teclado por fora do `StdinReader`.** O TUI recebe o eco pela opção `write` dele; um segundo leitor do teclado já travou um agente.
- **Escrever na tela por fora do `terminal.ts`.** O `terminalScreen` usa o `writeOut` e as funções de tela de lá.
- **Usar uma biblioteca de tela cheia** (Ink, blessed…): elas leem e escrevem no terminal por conta própria, passando por cima dos dois donos.
- **Fazer o agente saber que está num TUI.** Ele usa a `Interaction`; o TUI decide como mostrar.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, troque a tela para 5 linhas. Quais mensagens continuam aparecendo, e por quê?

2. **Intermediário.** Escreva um `TuiScreen` que, em vez de guardar só o último quadro, conte quantos quadros foram desenhados. Mande 100 pedaços com `stream` e descubra quantos redesenhos aconteceram. O que muda com `frameDelayMs: 0`?

3. **Difícil.** Acrescente um comando `/save <arquivo>` que grave a conversa (o `transcript`) num arquivo. Por que o arquivo deve ser gravado pelo `src/filesystem`, e não pelo `tui`? E por que a mensagem "Conversa salva em …" deve ser uma entrada `note`, e não um `write`?

[↑ topo](#topo)
