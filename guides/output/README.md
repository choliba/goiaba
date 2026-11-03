<a id="topo"></a>

# Módulo output: para que ele existe

Um programa **mostra coisas**: uma resposta, um aviso, uma linha de "pensando…". O módulo `output` é **a saída**: o lugar por onde passa tudo o que o Goiaba mostra, e o contrato que diz **para onde** isso vai.

O terminal é só um destino. A mesma mensagem pode ir para um arquivo, para uma página web, para a memória de um teste, ou para vários lugares ao mesmo tempo, **sem que quem a escreve saiba disso**:

```
quem mostra ──▶ Output ──▶ stdioOutput  (stdout / stderr)
(agente,           │
 comando,          ├─────▶ um arquivo
 relatório…)       ├─────▶ a página do site
                   └─────▶ a memória de um teste
```

O `output` **só mostra**. Ele não pergunta nem ouve ninguém: a conversa (perguntar, ouvir a resposta, mostrar) é do módulo `interaction`, que usa uma `Output` para a parte de mostrar. E o `output` **não depende de nenhum outro módulo** do Goiaba.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [O contrato: `Output`](#o-contrato-output)
  - [O terminal: `stdioOutput`](#o-terminal-terminaloutput)
  - [Por baixo: `terminal.ts`](#por-baixo-terminalts)
- [Como funciona](#como-funciona)
  - [Uma mensagem é uma linha](#uma-mensagem-é-uma-linha)
  - [A linha de status](#a-linha-de-status)
  - [Output e Interaction](#output-e-interaction)
- [Exemplos](#exemplos)
  - [1. O terminal](#1-o-terminal)
  - [2. Uma saída sua, na memória](#2-uma-saída-sua-na-memória)
  - [3. Para um arquivo, e para dois lugares](#3-para-um-arquivo-e-para-dois-lugares)
  - [4. A saída de uma conversa](#4-a-saída-de-uma-conversa)
  - [5. Como resposta HTTP](#5-como-resposta-http)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo       | Papel                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | O contrato `Output` e o destino padrão, `stdioOutput`.                                                                                                     |
| `terminal.ts` | **O único que escreve no stdout e no stderr** (`writeOut`, `writeErr`) e cuida da linha de status (`writeStatus`) e da largura do terminal (`ttyColumns`). |

[↑ topo](#topo)

## Interface

### O contrato: `Output`

```ts
interface Output {
  write(text: string): void; // uma mensagem
  error?(text: string): void; // um aviso, à parte da saída
  status?(text: string | undefined): void; // uma linha que se reescreve; undefined apaga
  width?(): number; // caracteres por linha
}
```

| Método   | Obrigatório | Se a saída não tiver                   |
| -------- | ----------- | -------------------------------------- |
| `write`  | sim         | —                                      |
| `error`  | não         | quem usa costuma mandar para o `write` |
| `status` | não         | o status não aparece                   |
| `width`  | não         | quem usa supõe 120                     |

Qualquer objeto com esses métodos é uma `Output`: não há classe para herdar.

### O terminal: `stdioOutput`

| Método   | Vai para                                                    |
| -------- | ----------------------------------------------------------- |
| `write`  | stdout, com `\n` no fim se faltar                           |
| `error`  | stderr, com `\n` no fim se faltar                           |
| `status` | a linha de status, só num terminal de verdade               |
| `width`  | as colunas do terminal; 120 se o stdout não for um terminal |

### Por baixo: `terminal.ts`

As funções de baixo nível, para quem precisa escrever no terminal **sem** passar por uma `Output` (o eco do que se digita, no `input`):

| Função              | O que faz                                          |
| ------------------- | -------------------------------------------------- |
| `writeOut(text)`    | escreve no stdout como está (sem acrescentar `\n`) |
| `writeErr(text)`    | escreve no stderr como está                        |
| `writeStatus(text)` | a linha de status (veja abaixo)                    |
| `ttyColumns()`      | as colunas do terminal, ou `undefined`             |

[↑ topo](#topo)

## Como funciona

### Uma mensagem é uma linha

`stdioOutput.write('oi')` e `stdioOutput.write('oi\n')` mostram a mesma coisa: cada mensagem é uma linha. Para escrever pedaços na mesma linha (o eco de cada tecla), use `writeOut`, que escreve como está.

### A linha de status

`status('⏳ pensando…')` mostra uma linha que **se reescreve no lugar**: o próximo `status` a substitui, `status(undefined)` a apaga, e qualquer mensagem escrita depois a apaga antes. Ela só aparece:

- num terminal de verdade (num pipe ou num arquivo, não faria sentido reescrever);
- no começo de uma linha, para nunca cobrir o que alguém está digitando.

### Output e Interaction

|             | `Output` (`src/output`)                | `Interaction` (`src/interaction`)                                         |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------- |
| o que é     | a saída: para onde vai o que se mostra | a conversa: perguntar, ouvir e mostrar                                    |
| métodos     | `write`, `error`, `status`, `width`    | `ask`, `listen`, `choose`, mais `write`, `status`, `width`                |
| no terminal | `stdioOutput`                          | `TerminalInteraction`, que ouve pelo `StdinReader` e mostra numa `Output` |

O agente, os comandos e a tela de aprovações conversam por uma `Interaction`. A `TerminalInteraction` recebe a `Output` para onde mostrar: o terminal, se nenhuma for dada.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `agents/meus-testes/output-exemplos/` que roda como está.

### 1. O terminal

`agents/meus-testes/output-exemplos/1-terminal.ts`:

```ts
/**
 * Exemplo 1 do curso de output: o destino padrão, o terminal. `write` vai
 * para o stdout, `error` para o stderr, e cada mensagem vira uma linha.
 *
 *   bun agents/meus-testes/output-exemplos/1-terminal.ts
 *   bun agents/meus-testes/output-exemplos/1-terminal.ts 2>/dev/null   # só o stdout
 */
import { stdioOutput } from '../../../src/output/index';

stdioOutput.write('uma mensagem');
stdioOutput.write('outra, já com quebra de linha\n');
stdioOutput.error?.('um aviso, no stderr');
stdioOutput.write(`largura: ${String(stdioOutput.width?.())}`);
```

Saída real (stdout e stderr juntos):

```
uma mensagem
outra, já com quebra de linha
um aviso, no stderr
largura: 120
```

E só o stdout, com `2>/dev/null`:

```
uma mensagem
outra, já com quebra de linha
largura: 120
```

O aviso foi para o stderr: some quando só o stdout é visto. A largura é 120 porque, ao rodar para este curso, o stdout não era um terminal.

### 2. Uma saída sua, na memória

`agents/meus-testes/output-exemplos/2-memoria.ts`:

```ts
/**
 * Exemplo 2 do curso de output: uma saída sua. Uma `Output` é qualquer
 * objeto com `write` (e, se quiser, `error`, `status`, `width`). Esta guarda
 * tudo na memória, como um teste faria para conferir o que foi mostrado.
 */
import { stdioOutput, type Output } from '../../../src/output/index';

/** Guarda cada mensagem, com o tipo dela. */
function memoryOutput(): Output & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (text) => lines.push(`write: ${text}`),
    error: (text) => lines.push(`error: ${text}`),
    status: (text) => lines.push(`status: ${String(text)}`),
  };
}

/** Quem mostra coisas recebe uma Output: não sabe para onde vão. */
function relatorio(output: Output): void {
  output.status?.('⏳ contando…');
  output.write('3 arquivos');
  output.status?.(undefined);
  output.error?.('1 arquivo ignorado');
}

const memory = memoryOutput();
relatorio(memory);
stdioOutput.write(`o que ficou na memória:\n  ${memory.lines.join('\n  ')}`);
```

Saída real:

```
o que ficou na memória:
  status: ⏳ contando…
  write: 3 arquivos
  status: undefined
  error: 1 arquivo ignorado
```

`relatorio` não sabe para onde está escrevendo. É assim que um teste confere o que foi mostrado.

### 3. Para um arquivo, e para dois lugares

`agents/meus-testes/output-exemplos/3-arquivo.ts`:

```ts
/**
 * Exemplo 3 do curso de output: mandar para um arquivo, e para dois lugares
 * ao mesmo tempo. A mesma função `relatorio` escreve no terminal, num
 * arquivo, ou nos dois, sem mudar nada nela.
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
import { stdioOutput, type Output } from '../../../src/output/index';

/** Cada mensagem vira uma linha do arquivo. */
function fileOutput(path: string): Output {
  return {
    write: (text) => {
      appendText(path, text.endsWith('\n') ? text : `${text}\n`);
    },
    error: (text) => {
      appendText(path, `[erro] ${text}\n`);
    },
  };
}

/** Repete cada mensagem em todas as saídas. */
function both(...outputs: readonly Output[]): Output {
  return {
    write: (text) => {
      for (const output of outputs) output.write(text);
    },
    error: (text) => {
      for (const output of outputs) {
        if (output.error === undefined) output.write(text);
        else output.error(text);
      }
    },
  };
}

function relatorio(output: Output): void {
  output.write('3 arquivos');
  output.error?.('1 arquivo ignorado');
}

const dir = join(goiabaCacheDir(environment()), 'output-exemplo', randomUUID());
ensureDirectory(dir);
const log = join(dir, 'relatorio.txt');

try {
  stdioOutput.write('--- no terminal e no arquivo:');
  relatorio(both(stdioOutput, fileOutput(log)));
  stdioOutput.write('--- o que ficou no arquivo:');
  stdioOutput.write(readText(log));
} finally {
  removePath(dir);
}
```

Saída real:

```
--- no terminal e no arquivo:
3 arquivos
1 arquivo ignorado
--- o que ficou no arquivo:
3 arquivos
[erro] 1 arquivo ignorado
```

O mesmo `relatorio` escreveu no terminal e no arquivo ao mesmo tempo. No arquivo, o aviso ganhou um `[erro]`: cada saída decide como mostrar cada tipo de mensagem.

### 4. A saída de uma conversa

`agents/meus-testes/output-exemplos/4-conversa.ts`:

```ts
/**
 * Exemplo 4 do curso de output: a saída de uma conversa. A
 * TerminalInteraction (do módulo interaction) ouve o terminal e mostra numa
 * Output: a do terminal por padrão, ou a que você der. Aqui, o que ela
 * mostra vai para a memória; quem lê o stdin continua sendo o terminal.
 */
import { TerminalInteraction } from '../../../src/interaction/index';
import { stdioOutput, type Output } from '../../../src/output/index';

const shown: string[] = [];
const memory: Output = {
  write: (text) => shown.push(text),
};

const interaction = new TerminalInteraction({ output: memory });
interaction.write('olá, do agente');
interaction.status('⏳ pensando…'); // esta Output não tem status: ignorado
interaction.write('pronto');
interaction.close();

stdioOutput.write(`a conversa mostrou: ${JSON.stringify(shown)}`);
```

Saída real:

```
a conversa mostrou: ["olá, do agente","pronto"]
```

A conversa continua ouvindo o terminal, mas o que ela mostra foi para a memória. É o caminho para levar o que um agente mostra a outro lugar sem reescrever a conversa inteira.

### 5. Como resposta HTTP

O caso do site: o que um trabalho mostra vira a resposta de uma requisição. O mesmo `relatorio` responde de dois jeitos, e só a `Output` muda:

| Rota       | `Output`                                              | O cliente recebe                                           |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `/texto`   | junta as mensagens na memória                         | tudo de uma vez, quando o trabalho termina                 |
| `/eventos` | cada mensagem vira um evento SSE (Server-Sent Events) | cada mensagem na hora em que é escrita, inclusive o status |

`agents/meus-testes/output-exemplos/5-http.ts`:

```ts
/**
 * Exemplo 5 do curso de output: a saída como resposta HTTP. O mesmo
 * `relatorio` responde de dois jeitos:
 *
 * - `/texto`: junta as mensagens e responde tudo de uma vez;
 * - `/eventos`: Server-Sent Events, cada mensagem vai ao cliente assim que
 *   é escrita (é como o site acompanha um agente, em agents/api.ts).
 *
 * O exemplo sobe o servidor numa porta livre, pede as duas rotas a si mesmo
 * e mostra o que o cliente recebeu, com o tempo de chegada.
 *
 *   bun agents/meus-testes/output-exemplos/5-http.ts
 */
import { stdioOutput, type Output } from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Mostra o andamento de um trabalho: não sabe que vai para a web. */
async function relatorio(output: Output): Promise<void> {
  output.status?.('⏳ contando os arquivos…');
  await pause(300);
  output.write('3 arquivos');
  output.status?.(undefined);
  await pause(300);
  output.error?.('1 arquivo ignorado');
}

/** Junta tudo na memória; o texto vira o corpo da resposta no fim. */
function textOutput(): Output & { body(): string } {
  const lines: string[] = [];
  return {
    write: (text) => lines.push(text),
    error: (text) => lines.push(`aviso: ${text}`),
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
  return {
    write: (text) => {
      send('message', text);
    },
    error: (text) => {
      send('error', text);
    },
    // Na web o status é um evento também; a página decide como mostrar.
    status: (text) => {
      send('status', text ?? '');
    },
  };
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
  stdioOutput.write(
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
      stdioOutput.write(`  ${ms}  ${line}`);
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

`bun agents/meus-testes/output-exemplos/5-http.ts` (saída real):

```
GET /texto → 200 text/plain; charset=utf-8
   616 ms  3 arquivos
   616 ms  aviso: 1 arquivo ignorado
GET /eventos → 200 text/event-stream
     1 ms  status: ⏳ contando os arquivos…
   301 ms  message: 3 arquivos
   301 ms  status: (apaga)
   602 ms  error: 1 arquivo ignorado
```

- `/texto`: as duas linhas chegaram juntas, depois de o trabalho inteiro terminar (~0,6 s).
- `/eventos`: cada mensagem chegou quando foi escrita (1 ms, 300 ms, 600 ms). O `status` virou um evento como os outros: num navegador, a página decide como mostrá-lo (um aviso que se atualiza, por exemplo), e o `status` vazio, que no terminal apaga a linha, chega como um evento sem dados.
- A `Output` da web não tem `width`: uma página não tem colunas fixas, e quem desenha tabelas usa o padrão.

É a mesma ideia do `agents/api.ts`, o servidor que liga os agentes ao site: lá, a conversa do agente é uma `Interaction` própria, cujo `write` manda um evento para quem está acompanhando. Com a `Output`, essa parte (mostrar) pode ser escrita uma vez e passada a uma `TerminalInteraction`, ou a qualquer conversa.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- **Escrever no stdout e no stderr.** Só o `terminal.ts`: nenhum `console`, nenhum `process.stdout.write` fora dele.

**Ninguém deve:**

- **Escrever direto no terminal o que é uma mensagem.** Receba uma `Output` e escreva nela: quem chama decide para onde vai.
- **Perguntar ou ouvir pelo `output`.** A conversa é do `interaction`; o `output` só mostra.
- **Usar o status para algo que precisa ficar registrado.** Ele some (e nem aparece fora de um terminal); o que importa vai num `write`.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, acrescente um `width` à saída de memória que devolva 40. O que muda em `relatorio`? E em quem desenha uma tabela com a largura da saída?

2. **Intermediário.** Escreva uma `Output` que só mostre as mensagens que contêm uma palavra (um filtro) e repasse para outra `Output`. Use-a para mandar ao terminal só os avisos (`error`) do Exemplo 3.

3. **Difícil.** A linha de status só aparece no começo de uma linha. Seguindo `writeStatus` e `track` em `terminal.ts`, o que acontece se alguém chamar `writeOut('digitando')` (sem `\n`) e depois `status('⏳ pensando…')`? Por que essa regra existe?

[↑ topo](#topo)
