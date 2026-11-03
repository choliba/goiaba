<a id="topo"></a>

# Módulo output: para que ele existe

Um programa **mostra coisas**: uma resposta, o raciocínio do modelo, um aviso, uma linha de "pensando…". O módulo `output` é **a saída**: o contrato de tudo o que o Goiaba mostra e o destino padrão, o **stdio** (stdout e stderr).

O stdio é só um destino. A mesma mensagem pode ir para um arquivo, para uma página web, para a memória de um teste, ou para vários lugares ao mesmo tempo, **sem que quem a escreve saiba disso**:

```
quem mostra ──▶ Output ──▶ stdioOutput  (stdout / stderr)
(conversa,         │
 comando,          ├─────▶ um arquivo
 relatório…)       ├─────▶ a página do site
                   └─────▶ a memória de um teste
```

O `output` **só mostra**. Ele não pergunta nem ouve ninguém: a conversa é do [`interaction`](../interaction/README.md), que mostra pela `Output` do seu adapter. E o `output` não depende de nenhum outro módulo do Goiaba.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [O contrato: `Output`](#o-contrato-output)
  - [Um destino que só tem `write`: `completeOutput`](#um-destino-que-só-tem-write-completeoutput)
  - [O stdio: `stdioOutput` e `stdio.ts`](#o-stdio-stdiooutput-e-stdiots)
- [Como funciona](#como-funciona)
  - [Inteiro ou em pedaços](#inteiro-ou-em-pedaços)
  - [Mensagem ou raciocínio](#mensagem-ou-raciocínio)
  - [stdio e tty](#stdio-e-tty)
  - [A linha de status](#a-linha-de-status)
- [Exemplos](#exemplos)
  - [1. O stdio](#1-o-stdio)
  - [2. Uma saída sua, na memória](#2-uma-saída-sua-na-memória)
  - [3. Para um arquivo, e para dois lugares](#3-para-um-arquivo-e-para-dois-lugares)
  - [4. Como resposta HTTP](#4-como-resposta-http)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo        | Papel                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.ts`     | o contrato `Output`, `OutputKind`, `completeOutput` e o destino `stdioOutput`                                          |
| `stdio.ts`     | o **único** escritor do stdout e do stderr: `writeOut`, `writeErr`, `writeStatus`, e o que só um terminal tem (`tty…`) |
| `constants.ts` | `DEFAULT_LINE_LENGTH` (120 colunas, para quem não tem linha) e `REASONING_MARK` (💭)                                   |

[↑ topo](#topo)

## Interface

### O contrato: `Output`

Todos os modos existem e se esperam com `await`: quem escreve escolhe o modo que tem, nunca confere qual existe.

| Método                       | O que faz                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `write(text, kind?)`         | uma mensagem inteira, como uma linha (o `\n` do fim é acrescentado)                              |
| `writeStream(pieces, kind?)` | os pedaços, como chegam, até `pieces` acabar; aceita um `Iterable` ou um `AsyncIterable`         |
| `error(text)`                | um diagnóstico para quem roda o programa, à parte da saída                                       |
| `status(text)`               | uma linha que se reescreve no lugar (`⏳ pensando…`); `undefined` a apaga                        |
| `lineLength()`               | quantas colunas cabem numa linha, para quem monta colunas (colunas da tela: um emoji ocupa duas) |

`kind` é um `OutputKind`: `'message'` (o padrão, o que é dito) ou `'reasoning'` (o que o modelo pensou antes), que cada destino mostra do seu jeito.

### Um destino que só tem `write`: `completeOutput`

`completeOutput(destination)` faz uma `Output` de um `PartialOutput`, que só precisa de `write`. O resto é feito aqui, **e só aqui**:

| Falta         | Vira                                                     |
| ------------- | -------------------------------------------------------- |
| `writeStream` | os pedaços juntados numa mensagem, quando o stream acaba |
| `error`       | uma mensagem (`write`)                                   |
| `status`      | nada (o destino não tem status)                          |
| `lineLength`  | `DEFAULT_LINE_LENGTH`                                    |

### O stdio: `stdioOutput` e `stdio.ts`

`stdioOutput` manda mensagens para o stdout e erros para o stderr. Por baixo, tudo passa pelo `stdio.ts`:

| Função                                             | O que faz                                                   |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `writeOut(text)`, `writeErr(text)`                 | escrevem como está, sem acrescentar `\n`                    |
| `writeStatus(text)`                                | a linha de status (só num tty)                              |
| `isAtLineStart()`                                  | se nada foi escrito pela metade na linha atual              |
| `ttyColumns()`, `ttyRows()`                        | o tamanho do terminal, ou `undefined` fora de um            |
| `onTtyResize(listener)`                            | avisa quando o terminal muda de tamanho; devolve como parar |
| `enterAlternateScreen()`, `leaveAlternateScreen()` | a tela alternativa dos programas em tela cheia (o TUI)      |

[↑ topo](#topo)

## Como funciona

### Inteiro ou em pedaços

`write` mostra uma coisa inteira; `writeStream` recebe o stream **inteiro**, um iterável, e o fim dele é o fim do iterável: ninguém precisa lembrar de chamar um `end()`, e dois streams nunca se cruzam. Uma ponta liga na outra: `output.writeStream(fonte.readStream())`.

O `writeStream` aceita `Iterable` (um array, um `function*`) ou `AsyncIterable` (um `async function*`, um stream), porque o `for await` percorre os dois. Por isso ele sempre devolve uma `Promise`.

### Mensagem ou raciocínio

O raciocínio do modelo é mostrado à parte da resposta. No stdio, ele vai numa linha própria, depois de `💭`, e a resposta começa na linha seguinte; no TUI, ele fica apagado (e `/thinking` o esconde); num arquivo JSONL, é uma linha `{"out":"reasoning",…}`.

### stdio e tty

**stdio** são os canais padrão do processo: existem sempre, num terminal, num pipe ou num arquivo. **tty** é o que só um terminal de verdade tem: colunas, linhas, a tela alternativa, a linha de status. Por isso as funções de terminal se chamam `tty…` e não fazem nada (ou devolvem `undefined`) sem um.

### A linha de status

`status('⏳ pensando…')` mostra uma linha que **se reescreve no lugar**: o próximo `status` a substitui, `status(undefined)` a apaga, e qualquer mensagem escrita depois a apaga antes. No stdio ela só aparece:

- num tty (num pipe ou num arquivo, não faria sentido reescrever);
- no começo de uma linha, para nunca cobrir o que alguém está digitando.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `guides/output/exemplos/` que roda como está.

### 1. O stdio

`guides/output/exemplos/1-stdio.ts`:

```ts
/**
 * Exemplo 1 do curso de output: o stdio. `stdioOutput` manda as mensagens
 * para o stdout e os erros para o stderr. Os modos se esperam com `await`:
 * uma mensagem inteira (`write`) ou os pedaços dela (`writeStream`), de um
 * array ou de um gerador assíncrono. O raciocínio vai numa linha própria,
 * depois de 💭.
 */
import { stdioOutput } from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function* resposta(): AsyncGenerator<string> {
  for (const piece of ['Três ', 'arquivos ', 'mudaram.\n']) {
    await pause(50);
    yield piece;
  }
}

await stdioOutput.write('uma mensagem é uma linha');
await stdioOutput.writeStream(['pedaços ', 'de um ', 'array\n']);
await stdioOutput.writeStream(['pensando ', 'no que mudou'], 'reasoning');
await stdioOutput.writeStream(resposta());
await stdioOutput.error('isto vai para o stderr');
await stdioOutput.write(
  `uma linha aqui tem ${String(stdioOutput.lineLength())} colunas`,
);
```

`bun guides/output/exemplos/1-stdio.ts` (num pipe, por isso 120 colunas):

```
uma mensagem é uma linha
pedaços de um array
💭 pensando no que mudou
Três arquivos mudaram.
isto vai para o stderr
uma linha aqui tem 120 colunas
```

### 2. Uma saída sua, na memória

`guides/output/exemplos/2-memoria.ts`:

```ts
/**
 * Exemplo 2 do curso de output: uma saída sua. Um destino só precisa de
 * `write`; o `completeOutput` faz o resto, e num lugar só: os pedaços de um
 * stream viram uma mensagem quando ele acaba, um erro vira uma mensagem, o
 * status é ignorado e a linha tem `DEFAULT_LINE_LENGTH` colunas. Esta saída
 * guarda tudo na memória, como um teste faria.
 */
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

const lines: string[] = [];
const memory = completeOutput({
  write: (text, kind = 'message') => {
    lines.push(`${kind}: ${text}`);
  },
});

/** Quem mostra coisas recebe uma Output: não sabe para onde vão. */
async function relatorio(output: Output): Promise<void> {
  await output.status('⏳ contando…');
  await output.writeStream(['3 ', 'arquivos']);
  await output.write('olhando um por um', 'reasoning');
  await output.status(undefined);
  await output.error('1 arquivo ignorado');
}

await relatorio(memory);
await stdioOutput.write(`o que ficou na memória:\n  ${lines.join('\n  ')}`);
await stdioOutput.write(`colunas: ${String(memory.lineLength())}`);
```

Saída real:

```
o que ficou na memória:
  message: 3 arquivos
  reasoning: olhando um por um
  message: 1 arquivo ignorado
colunas: 120
```

O stream virou uma mensagem só, o erro virou uma mensagem e o status sumiu: o destino só tinha `write`.

### 3. Para um arquivo, e para dois lugares

`guides/output/exemplos/3-arquivo.ts`:

```ts
/**
 * Exemplo 3 do curso de output: mandar para um arquivo, e para dois lugares
 * ao mesmo tempo. A mesma função `relatorio` escreve no stdio, num arquivo,
 * ou nos dois, sem mudar nada nela.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
} from '../../../src/filesystem/index';
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

/** Cada mensagem vira uma linha do arquivo. */
function fileOutput(path: string): Output {
  return completeOutput({
    write: (text) => {
      appendText(path, text.endsWith('\n') ? text : `${text}\n`);
    },
    error: (text) => {
      appendText(path, `[erro] ${text}\n`);
    },
  });
}

/** Repete cada mensagem em todas as saídas. */
function both(...outputs: readonly Output[]): Output {
  return completeOutput({
    write: async (text, kind) => {
      for (const output of outputs) await output.write(text, kind);
    },
    error: async (text) => {
      for (const output of outputs) await output.error(text);
    },
  });
}

async function relatorio(output: Output): Promise<void> {
  await output.write('3 arquivos');
  await output.error('1 arquivo ignorado');
}

const dir = join(goiabaCacheDir(environment()), 'output-exemplo', randomUUID());
ensureDirectory(dir);
const log = join(dir, 'relatorio.txt');

try {
  await stdioOutput.write('--- no stdio e no arquivo:');
  await relatorio(both(stdioOutput, fileOutput(log)));
  await stdioOutput.write('--- o que ficou no arquivo:');
  await stdioOutput.write(readText(log));
} finally {
  removePath(dir);
}
```

Saída real:

```
--- no stdio e no arquivo:
3 arquivos
1 arquivo ignorado
--- o que ficou no arquivo:
3 arquivos
[erro] 1 arquivo ignorado
```

### 4. Como resposta HTTP

`guides/output/exemplos/4-http.ts`:

```ts
/**
 * Exemplo 4 do curso de output: a saída como resposta HTTP. O mesmo
 * `relatorio` responde de dois jeitos:
 *
 * - `/texto`: junta as mensagens e responde tudo de uma vez (o stream vira
 *   uma mensagem só, pelo `completeOutput`);
 * - `/eventos`: Server-Sent Events, cada pedaço vai ao cliente assim que é
 *   escrito (é como o site acompanha um agente, em agents/api.ts).
 *
 * O exemplo sobe o servidor numa porta livre, pede as duas rotas a si mesmo
 * e mostra o que o cliente recebeu, com o tempo de chegada.
 *
 *   bun guides/output/exemplos/4-http.ts
 */
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Mostra o andamento de um trabalho: não sabe que vai para a web. */
async function relatorio(output: Output): Promise<void> {
  await output.status('⏳ contando os arquivos…');
  await pause(300);
  await output.writeStream(contando());
  await output.status(undefined);
  await output.error('1 arquivo ignorado');
}

/** A resposta em pedaços, como um modelo escreve. */
async function* contando(): AsyncGenerator<string> {
  for (const piece of ['3 ', 'arquivos']) {
    await pause(200);
    yield piece;
  }
}

/** Junta tudo na memória; o texto vira o corpo da resposta no fim. */
function textOutput(): Output & { body(): string } {
  const lines: string[] = [];
  return {
    ...completeOutput({
      write: (text) => {
        lines.push(text);
      },
      error: (text) => {
        lines.push(`aviso: ${text}`);
      },
    }),
    body: () => `${lines.join('\n')}\n`,
  };
}

/** Cada mensagem é um evento SSE, enviado na hora. */
function eventsOutput(
  controller: ReadableStreamDefaultController<Uint8Array>,
): Output {
  const encoder = new TextEncoder();
  const send = (event: string, data: string): void => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  };
  return completeOutput({
    write: (text) => {
      send('message', text);
    },
    // Cada pedaço é um evento: o cliente vê a resposta sendo escrita.
    writeStream: async (pieces) => {
      for await (const piece of pieces) send('piece', piece);
    },
    error: (text) => {
      send('error', text);
    },
    // Na web o status é um evento também; a página decide como mostrar.
    status: (text) => {
      send('status', text ?? '');
    },
  });
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/texto') {
      const output = textOutput();
      await relatorio(output);
      return new Response(output.body(), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (pathname === '/eventos') {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          await relatorio(eventsOutput(controller));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    return new Response('não encontrado', { status: 404 });
  },
});

/** O cliente: mostra o que chega da resposta, com o tempo de chegada. */
async function ask(path: string): Promise<void> {
  const startedAt = performance.now();
  const response = await fetch(
    `http://127.0.0.1:${String(server.port)}${path}`,
  );
  await stdioOutput.write(
    `GET ${path} → ${String(response.status)} ${response.headers.get('content-type') ?? ''}`,
  );
  if (response.body === null) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    // Os tipos do Bun dão o pedaço como `any`: ele é conferido.
    const read: { readonly done: boolean; readonly value?: unknown } =
      await reader.read();
    if (read.done) return;
    if (!(read.value instanceof Uint8Array)) continue;
    const value = read.value;
    const ms = `${String(Math.round(performance.now() - startedAt)).padStart(4)} ms`;
    for (const line of readable(decoder.decode(value))) {
      await stdioOutput.write(`  ${ms}  ${line}`);
    }
  }
}

/** Um evento SSE (`event: x` + `data: y`) vira `x: y`; um texto, suas linhas. */
function readable(text: string): string[] {
  if (!text.startsWith('event: ')) return text.trimEnd().split('\n');
  return text
    .split('\n\n')
    .filter((block) => block !== '')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = /^data: ?(.*)$/m.exec(block)?.[1] ?? '';
      return `${event}: ${data === '' ? '(apaga)' : data}`;
    });
}

try {
  await ask('/texto');
  await ask('/eventos');
} finally {
  await server.stop(true);
}
```

Saída real (os tempos mudam a cada execução):

```
GET /texto → 200 text/plain; charset=utf-8
   721 ms  3 arquivos
   721 ms  aviso: 1 arquivo ignorado
GET /eventos → 200 text/event-stream
     1 ms  status: ⏳ contando os arquivos…
   502 ms  piece: 3
   702 ms  piece: arquivos
   702 ms  status: (apaga)
   702 ms  error: 1 arquivo ignorado
```

Em `/texto`, a resposta só chega no fim, com o stream juntado pelo `completeOutput`. Em `/eventos`, cada pedaço chega quando é escrito.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- **Escrever no stdout e no stderr.** Só o `stdio.ts`: nenhum `console`, nenhum `process.stdout.write` fora dele.

**Ninguém deve:**

- **Escrever direto no stdio o que é uma mensagem.** Receba uma `Output` e escreva nela: quem chama decide para onde vai.
- **Conferir se um modo existe.** Todos existem; quem não tem um, completa com o `completeOutput`.
- **Perguntar ou ouvir pelo `output`.** A conversa é do `interaction`; o `output` só mostra.
- **Usar o status para algo que precisa ficar registrado.** Ele some (e nem aparece fora de um tty); o que importa vai num `write`.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, acrescente um `lineLength` à saída de memória que devolva 40. O que muda no que o exemplo mostra?
2. **Médio.** Escreva uma `Output` que só repasse a outra os `error` e descarte as mensagens. Use-a no Exemplo 3 para mandar ao stdio só os avisos.
3. **Avançado.** No Exemplo 1, chame `writeOut('digitando')` (sem `\n`) antes do `writeStream` de raciocínio. Onde o `💭` aparece, e por quê? (Veja `isAtLineStart` em `stdio.ts`.)

[↑ topo](#topo)
