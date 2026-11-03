<a id="topo"></a>

# Adapters: cada forma de conversar

A [conversa](../interaction/README.md) não sabe por onde passa. Quem sabe é o **adapter**: uma peça por forma de conversar, que fica **na frente**, colada à fonte, e traduz nos dois sentidos. O que chega vira **eventos** (`message`, `choice`, `interrupt`, `command`); o que a conversa mostra sai pela **`Output`** do adapter. Tudo o que é da forma (teclas, eco, a linha sendo digitada, uma tela, um arquivo) fica dentro dele.

```
            ┌──────────────── adapter ────────────────┐
fonte    →  │ decoder: bytes, teclas, linhas → eventos │  →  eventos  →  Conversation
destino  ←  │ Output: mostra do jeito da forma         │  ←  write, stream, reasoning, status
            └─────────────────────────────────────────┘
```

Este curso trata do **stdio** (`src/adapters/stdio`) e do **JSONL** (`src/adapters/jsonl`). O de tela cheia tem um curso próprio: [TUI](../tui/README.md).

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`StdioAdapter`](#stdioadapter)
  - [As peças do stdio](#as-peças-do-stdio)
  - [`JsonlAdapter`](#jsonladapter)
  - [Constantes](#constantes)
- [Como funciona](#como-funciona)
  - [Num pipe e num terminal](#num-pipe-e-num-terminal)
  - [A digitação](#a-digitação)
  - [Registros e o limite de bytes](#registros-e-o-limite-de-bytes)
  - [O arquivo de conversa](#o-arquivo-de-conversa)
  - [Desfazer o que fez](#desfazer-o-que-fez)
  - [Escrever um adapter](#escrever-um-adapter)
- [Exemplos](#exemplos)
  - [1. O stdio num pipe](#1-o-stdio-num-pipe)
  - [2. O que um terminal manda vira teclas](#2-o-que-um-terminal-manda-vira-teclas)
  - [3. A digitação, sem terminal](#3-a-digitação-sem-terminal)
  - [4. A conversa por um arquivo](#4-a-conversa-por-um-arquivo)
  - [5. Num terminal de verdade](#5-num-terminal-de-verdade)
- [Regras](#regras)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo            | Papel                                                                            |
| ------------------ | -------------------------------------------------------------------------------- |
| `constants.ts`     | `DEFAULT_MAX_RECORD_BYTES`, `DEFAULT_POLL_MS`, `DEFAULT_FRAME_DELAY_MS`          |
| `stdio/index.ts`   | `StdioAdapter`, `StdioSource`, `stdinSource`, `readKeys`, `PASTE_ON`/`PASTE_OFF` |
| `stdio/keys.ts`    | `KeyDecoder`: o texto que um terminal manda vira teclas                          |
| `stdio/line.ts`    | `LineEditor`: a linha sendo digitada, como texto                                 |
| `stdio/typing.ts`  | `Typing`: teclas viram eventos (serve ao stdio e ao TUI)                         |
| `stdio/records.ts` | `records`: pedaços de texto viram linhas, com limite de bytes                    |
| `jsonl/index.ts`   | `JsonlAdapter`: a conversa por um arquivo                                        |
| `tui/`             | o TUI (veja o [curso dele](../tui/README.md))                                    |

[↑ topo](#topo)

## Interface

### `StdioAdapter`

`new StdioAdapter(options?)`, um `InteractionAdapter`:

| Opção            | O que faz                                                                             |
| ---------------- | ------------------------------------------------------------------------------------- |
| `shortcuts`      | teclas que mandam um comando pelo nome: `{ '\u0001': 'approvals' }` (Ctrl+A)          |
| `maxRecordBytes` | o máximo de bytes de uma linha lida de um pipe; `DEFAULT_MAX_RECORD_BYTES` por padrão |
| `output`         | por onde sai o que se mostra; `stdioOutput` por padrão                                |
| `source`         | de onde lê (`StdioSource`); o stdin por padrão                                        |
| `echo`           | para onde vai o eco do que se digita; o stdout por padrão                             |

Um `StdioSource` é `{ tty, read({ raw, signal }) }`: troque-o (e o `echo`) para testar a digitação sem um terminal.

### As peças do stdio

| Peça                                       | O que faz                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `KeyDecoder(onSequence?)`                  | `feed(chunk)` devolve as teclas (`{ key, pasted }`); as sequências que não são texto (setas, PageUp) vão inteiras para `onSequence` |
| `LineEditor`                               | `insert`, `erase` (um caractere como se vê: um acento e sua letra, um emoji), `take`, `text`                                        |
| `Typing(options)`                          | `feed(chunk)` e `request(request)`: teclas viram eventos; quem a usa diz como mostrar (`echo`, `onLine`)                            |
| `records(pieces, max?)`                    | as linhas de um stream de texto, conforme fecham                                                                                    |
| `readKeys(source, signal, typing, events)` | lê o terminal em raw e alimenta a `Typing` até a fonte acabar                                                                       |

### `JsonlAdapter`

`new JsonlAdapter({ path, maxRecordBytes?, pollMs?, startEmpty? })`, um `InteractionAdapter`:

| Opção            | O que faz                                                           |
| ---------------- | ------------------------------------------------------------------- |
| `path`           | o arquivo da conversa: o que entra e o que sai, uma linha cada      |
| `maxRecordBytes` | o máximo de bytes de uma linha                                      |
| `pollMs`         | de quanto em quanto tempo o arquivo é lido; `DEFAULT_POLL_MS` (500) |
| `startEmpty`     | esvazia o arquivo antes: uma conversa nova a cada execução          |

### Constantes

| Constante                  | Valor | Para quê                                              |
| -------------------------- | ----- | ----------------------------------------------------- |
| `DEFAULT_MAX_RECORD_BYTES` | 1 MiB | o máximo de uma linha (um registro), não de um pedaço |
| `DEFAULT_POLL_MS`          | 500   | a leitura de um arquivo de conversa                   |
| `DEFAULT_FRAME_DELAY_MS`   | 16    | o intervalo entre redesenhos do TUI                   |

[↑ topo](#topo)

## Como funciona

### Num pipe e num terminal

O `StdioAdapter` decide pela fonte:

- **num pipe ou num arquivo**, cada linha é uma `message`, e nada pode ser pedido: `request` devolve `undefined` (a conversa segue com o que chega). A saída é o stdio;
- **num terminal**, as teclas são lidas em raw e passam pela `Typing`, e o eco é escrito como o terminal escreveria.

### A digitação

A `Typing` transforma teclas em eventos, do mesmo jeito para o stdio e o TUI:

| Tecla                                  | O que acontece                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| letras, acentos, emoji                 | entram na linha sendo digitada                                                |
| Backspace                              | apaga o último caractere como se vê                                           |
| texto colado                           | entra inteiro, com as quebras de linha; só um Enter **digitado** envia        |
| Enter                                  | `message` com a linha                                                         |
| uma tecla de `instant`, na linha vazia | `message` com a tecla, sem Enter                                              |
| durante uma escolha                    | a próxima tecla das `keys` é a `choice` (as outras esperam); Enter é o padrão |
| um atalho (`shortcuts`)                | `command` com o nome                                                          |
| Ctrl+C                                 | `interrupt`                                                                   |
| Ctrl+D                                 | fim da entrada (numa escolha, é o padrão)                                     |
| setas, PageUp e outras sequências      | nunca viram texto; vão para quem as quer (o TUI rola a tela)                  |

### Registros e o limite de bytes

Um **pedaço** é o que chega de cada vez da fonte, e quem decide o tamanho é o sistema. Um **registro** é uma unidade completa: uma linha de um pipe, uma linha de um arquivo JSONL. Um registro pode vir em vários pedaços, e um pedaço pode trazer vários registros. `maxRecordBytes` limita o **registro**: sem limite, uma linha que nunca termina cresceria na memória para sempre. Passou do limite, é um `UsageError`, nunca um corte em silêncio.

### O arquivo de conversa

O `JsonlAdapter` lê um arquivo que só cresce (como um log). Cada linha que entra é um evento, escrito como o `InputEvent`:

```
{"type":"message","text":"oi"}
{"type":"choice","key":"s"}
{"type":"command","name":"approvals"}
{"type":"interrupt"}
```

O que sai é `{"out":"message"|"reasoning"|"error","text":…}`, uma linha cada: o adapter nunca lê de volta o que escreveu. Um stream é uma linha só, quando termina. Uma linha que não é evento é recusada. Um arquivo não pergunta nem tem linha de status.

### Desfazer o que fez

Cada adapter desfaz o que fez, ao fechar e também quando o programa termina no meio (`onProgramExit`): o stdio desliga o modo de colagem, e a fonte desliga o raw mode. Quem roda o programa não precisa saber que existe um terminal.

### Escrever um adapter

Um adapter é qualquer objeto com `events()`, `request()`, `output` e `close()`. O [primeiro exemplo de interaction](../interaction/README.md#1-um-adapter-seu) faz um com uma lista de eventos; um chat web seria um que lê frames de um websocket e tem uma `Output` que manda frames de volta.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `guides/adapters/exemplos/` que roda como está. Só o 5 precisa de um terminal.

### 1. O stdio num pipe

`guides/adapters/exemplos/1-pipe.ts`:

```ts
/**
 * Exemplo 1 do curso de adapters: o stdio num pipe. Cada linha que chega é
 * uma mensagem; nada pode ser pedido (um pipe não tem teclas nem prompt),
 * então os pedidos são ignorados e o que chega responde. A saída é o stdio.
 */
import { StdioAdapter } from '../../../src/adapters/stdio/index';
import { Conversation } from '../../../src/interaction/index';

const conversation = new Conversation(new StdioAdapter());

for (;;) {
  let line: string;
  try {
    line = await conversation.ask('');
  } catch {
    break; // o stdin acabou
  }
  conversation.write(`ouvi: ${line}`);
}
conversation.write('fim da entrada');
conversation.close();
```

`printf 'oi\ntchau\n' | bun guides/adapters/exemplos/1-pipe.ts`:

```
ouvi: oi
ouvi: tchau
fim da entrada
```

### 2. O que um terminal manda vira teclas

`guides/adapters/exemplos/2-teclas.ts`:

```ts
/**
 * Exemplo 2 do curso de adapters: o que um terminal manda vira teclas. O
 * KeyDecoder não precisa de terminal: é só dar o texto. Ele marca o que foi
 * colado, separa setas e outras sequências (que nunca viram texto) e aguenta
 * sequências partidas entre dois pedaços.
 */
import { KeyDecoder } from '../../../src/adapters/stdio/index';
import { writeOut } from '../../../src/output/stdio';

const ESC = '\u001b';
const show = (label: string, chunks: readonly string[]): void => {
  const sequences: string[] = [];
  const decoder = new KeyDecoder((sequence) => sequences.push(sequence));
  const keys = chunks.flatMap((chunk) => decoder.feed(chunk));
  const typed = keys
    .map(
      ({ key, pasted }) => `${JSON.stringify(key)}${pasted ? '(colado)' : ''}`,
    )
    .join(' ');
  const other = sequences.map((sequence) => JSON.stringify(sequence)).join(' ');
  writeOut(
    `${label.padEnd(28)} → ${typed}${other === '' ? '' : `  sequências: ${other}`}\n`,
  );
};

show('digitado: ab + Enter', ['ab\r']);
show('seta para cima no meio', [`a${ESC}[Ab`]);
show('Alt+x', [`${ESC}x`]);
show('colado: a, quebra, b', [`${ESC}[200~a\nb${ESC}[201~`]);
show('a marca de colagem partida', [`${ESC}[2`, `00~xy${ESC}[2`, '01~z']);
show('PageUp', [`${ESC}[5~`]);
```

Saída real:

```
digitado: ab + Enter         → "a" "b" "\r"
seta para cima no meio       → "a" "b"  sequências: "\u001b[A"
Alt+x                        → "x"
colado: a, quebra, b         → "a"(colado) "\n"(colado) "b"(colado)
a marca de colagem partida   → "x"(colado) "y"(colado) "z"
PageUp                       →   sequências: "\u001b[5~"
```

### 3. A digitação, sem terminal

`guides/adapters/exemplos/3-digitacao.ts`:

```ts
/**
 * Exemplo 3 do curso de adapters: o stdio num terminal, sem precisar de
 * um. A fonte (`source`) e o eco (`echo`) são trocáveis: aqui as teclas vêm
 * de uma lista, e o eco, que num terminal iria para a tela, é guardado para
 * mostrar. Digitamos com um erro e o apagar, colamos duas linhas, apertamos
 * Ctrl+A (o comando `approvals`) e respondemos uma escolha com uma tecla.
 */
import {
  StdioAdapter,
  type StdioSource,
} from '../../../src/adapters/stdio/index';
import { OutputStream } from '../../../src/execute/stream';
import { Conversation } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const keys = new OutputStream<string>();
const keyboard: StdioSource = { tty: true, read: () => keys };
const echoed: string[] = [];

const conversation = new Conversation(
  new StdioAdapter({
    source: keyboard,
    echo: (text) => echoed.push(text),
    shortcuts: { '\u0001': 'approvals' },
  }),
);

const asked = conversation.ask('');
keys.publish('olx\u007fá\r'); // "olx", apagar, "á", Enter
const first = await asked;

const pasted = conversation.ask('');
keys.publish('\u001b[200~linha um\nlinha dois\u001b[201~\r');
const second = await pasted;

const command = conversation.ask('');
keys.publish('\u0001');
const third = await command;

const choice = conversation.choose(['s', 'n']);
keys.publish('x'); // fora da escolha: espera
keys.publish('S');
const fourth = await choice;
conversation.close();

await stdioOutput.write(`1: ${JSON.stringify(first)}`);
await stdioOutput.write(`2: ${JSON.stringify(second)}`);
await stdioOutput.write(`3: ${JSON.stringify(third)}`);
await stdioOutput.write(`4: ${JSON.stringify(fourth)}`);
await stdioOutput.write(`o eco: ${JSON.stringify(echoed.join(''))}`);
```

Saída real:

```
1: "olá"
2: "linha um\nlinha dois"
3: ":approvals"
4: "s"
o eco: "\u001b[?2004holx\b \bá\nlinha um\nlinha dois\n\ns\n\u001b[?2004l"
```

No eco: o modo de colagem ligado (`\u001b[?2004h`) e desligado no fim, o apagar (`\b \b`), as quebras do texto colado, e a escolha mostrada pelo próprio adapter.

### 4. A conversa por um arquivo

`guides/adapters/exemplos/4-jsonl.ts`:

```ts
/**
 * Exemplo 4 do curso de adapters: a conversa por um arquivo. O JsonlAdapter
 * lê as linhas que alguém acrescenta ao arquivo (cada uma, um evento) e
 * escreve no mesmo arquivo o que a conversa mostra (`{"out": …}`). Aqui,
 * quem acrescenta as linhas é o próprio exemplo, como outro programa faria.
 */
import { randomUUID } from 'node:crypto';

import { JsonlAdapter } from '../../../src/adapters/jsonl/index';
import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
} from '../../../src/filesystem/index';
import { Conversation } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const dir = join(goiabaCacheDir(environment()), 'jsonl-exemplo', randomUUID());
ensureDirectory(dir);
const path = join(dir, 'conversa.jsonl');

try {
  const conversation = new Conversation(
    new JsonlAdapter({ path, pollMs: 20, startEmpty: true }),
  );
  conversation.write('Oi! Em que posso ajudar?');

  const asked = conversation.ask('');
  // Outro programa (ou uma pessoa) acrescenta uma linha ao arquivo.
  appendText(
    path,
    `${JSON.stringify({ type: 'message', text: 'resuma o README' })}\n`,
  );
  const message = await asked;

  conversation.reasoning('vou ler o README');
  conversation.stream('O README ');
  conversation.stream('explica o projeto.');
  conversation.close();
  await new Promise((resolve) => setTimeout(resolve, 20));

  await stdioOutput.write(`a conversa ouviu: ${message}`);
  await stdioOutput.write(`o arquivo:\n${readText(path).trimEnd()}`);
} finally {
  removePath(dir);
}
```

Saída real:

```
a conversa ouviu: resuma o README
o arquivo:
{"out":"message","text":"Oi! Em que posso ajudar?"}
{"type":"message","text":"resuma o README"}
{"out":"reasoning","text":"vou ler o README"}
{"out":"message","text":"O README explica o projeto."}
```

### 5. Num terminal de verdade

`guides/adapters/exemplos/5-terminal.ts`:

```ts
/**
 * Exemplo 5 do curso de adapters: num terminal de verdade. É a conversa que
 * um agente usa (`agentConversation`): o stdio com o Ctrl+A. Rode num
 * terminal (não num pipe) e digite:
 *
 *   bun guides/adapters/exemplos/5-terminal.ts
 *
 *   1. "q" numa linha vazia: responde na hora, sem Enter (`instant`);
 *   2. "oi" e Enter;
 *   3. Ctrl+A: chega como a linha ":approvals";
 *   4. "s" para a escolha.
 */
import { agentConversation } from '../../../src/agent/agent';

const conversation = agentConversation();

conversation.write('digite q (sem Enter):');
conversation.write(
  `recebeu ${JSON.stringify(await conversation.ask('', undefined, ['q']))}`,
);
conversation.write('digite oi e Enter:');
conversation.write(`recebeu ${JSON.stringify(await conversation.ask(''))}`);
conversation.write('aperte Ctrl+A:');
conversation.write(`recebeu ${JSON.stringify(await conversation.ask(''))}`);
conversation.write('s ou n?');
conversation.write(
  `recebeu ${JSON.stringify(await conversation.choose(['s', 'n']))}`,
);
conversation.close();
```

Precisa de um terminal (num pipe, não há teclas). Rodando e digitando `q`, `oi` e Enter, Ctrl+A e `s`, a tela fica assim:

```
digite q (sem Enter):
q
recebeu "q"
digite oi e Enter:
oi
recebeu "oi"
aperte Ctrl+A:

recebeu ":approvals"
s ou n?
s
recebeu "s"
```

[↑ topo](#topo)

## Regras

- **Tudo o que é da forma fica no adapter.** Teclas, eco, telas, arquivos: nada disso chega à conversa, só eventos.
- **Um adapter desfaz o que fez**, inclusive quando o programa termina no meio.
- **O stdin passa pelo `src/input`**, o stdout e o stderr pelo `src/output/stdio.ts`, o disco pelo `src/filesystem`: o adapter usa os donos, não o `process` nem o `node:fs`.
- **Limites têm padrão e opção**: `maxRecordBytes`, `pollMs` e `frameDelayMs` vêm do `constants.ts`, e quem cria o adapter pode trocar.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 1, rode com `printf 'sem fim de linha' | bun …`. A última linha, sem `\n`, chega?
2. **Médio.** No Exemplo 3, passe `maxRecordBytes: 5` ao adapter. Muda alguma coisa? Por quê? (Pense em quando o limite vale.)
3. **Avançado.** Escreva um adapter que lê eventos de um websocket (`Bun.serve`, com `websocket`) e manda o que a conversa mostra de volta como frames. Use o `completeOutput` para a saída.

[↑ topo](#topo)
