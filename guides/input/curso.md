<a id="topo"></a>

# Módulo input: para que ele existe

Um programa que conversa com alguém precisa **ler o que a pessoa digita**. Parece simples, mas o Goiaba precisa de mais do que "ler uma linha":

- enquanto o agente trabalha, a pessoa pode digitar a próxima mensagem, e ela não pode se perder;
- uma aprovação pede **uma tecla** (`s`/`n`), não uma linha, e essa tecla não pode ir parar no meio da mensagem que estava sendo digitada;
- um texto colado tem quebras de linha que **não** são Enter;
- setas e outras teclas especiais não podem virar texto (`[A`).

O módulo `input` é **o único leitor do terminal**. Ele entrega mensagens completas (linhas, escolhas), nunca bytes soltos. E ele **só lê**: o que fazer além disso (mostrar o que se digita, o que o Ctrl+C faz, quais teclas são atalhos) é decidido por quem o cria.

```
teclado / pipe ──▶ StdinReader ──▶ next(): uma linha
                        │            choose(['s','n']): uma tecla
                        │
             opções de quem cria: write (eco), onInterrupt (Ctrl+C),
                                  shortcuts (tecla → linha), urgent (fura a fila)
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`StdinReader`](#stdinreader)
  - [As opções: o que não é ler](#as-opções-o-que-não-é-ler)
  - [`KeyDecoder` e `readAllInput`](#keydecoder-e-readallinput)
- [Como funciona](#como-funciona)
  - [Terminal ou pipe](#terminal-ou-pipe)
  - [A fila e o que fura a fila](#a-fila-e-o-que-fura-a-fila)
  - [Teclas especiais](#teclas-especiais)
  - [Quem usa](#quem-usa)
- [Exemplos](#exemplos)
  - [1. Tudo o que veio pelo stdin](#1-tudo-o-que-veio-pelo-stdin)
  - [2. Linha a linha, sem terminal](#2-linha-a-linha-sem-terminal)
  - [3. Cancelar a espera](#3-cancelar-a-espera)
  - [4. O que o terminal manda vira teclas](#4-o-que-o-terminal-manda-vira-teclas)
  - [5. Num terminal de verdade](#5-num-terminal-de-verdade)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo    | Papel                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | `StdinReader` (o leitor), `StdinReaderOptions`, `KeyDecoder` (texto do terminal → teclas) e `readAllInput` (todo o stdin de uma vez). |

O módulo depende só do `filesystem` (para ler o stdin inteiro, pelo `readDescriptor`) e do logger (o que se digita vai para o log em `debug`).

[↑ topo](#topo)

## Interface

### `StdinReader`

| Membro                      | O que faz                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `new StdinReader(options?)` | o leitor; veja as opções abaixo                                                                                 |
| `next(signal?, instant?)`   | a próxima linha. Num terminal, uma tecla de `instant` digitada numa linha vazia é a resposta na hora, sem Enter |
| `choose(keys, signal?)`     | uma das `keys`, com uma tecla só (`''` para Enter). Sem terminal, a primeira letra da próxima linha             |
| `close()`                   | para de ler; quem esperava recebe um `AbortError`                                                               |

`next` e `choose` aceitam um `AbortSignal`: abortar cancela a espera com um `AbortError`.

### As opções: o que não é ler

`StdinReaderOptions`, todas opcionais:

| Opção           | O que é                                                                                                 | Sem ela                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `write(texto)`  | o que o input escreve no terminal: o **eco** do que se digita e as sequências que marcam o texto colado | nada aparece enquanto se digita (o modo raw não mostra), e as quebras de um texto colado o enviam |
| `onInterrupt()` | o que o Ctrl+C faz (no modo raw, o terminal não manda o `SIGINT`)                                       | só fecha a leitura                                                                                |
| `shortcuts`     | `{ tecla: linha }`: a tecla envia aquela linha na hora, **na frente** da fila                           | nenhum atalho                                                                                     |
| `urgent(linha)` | quais linhas digitadas vão **na frente** da fila                                                        | nenhuma                                                                                           |

O `TerminalInteraction` (a conversa no terminal, do `interaction`) cria o seu `StdinReader` com `write` (o `writeOut`) e `onInterrupt` (o Ctrl+C vira um `SIGINT`), e aceita `shortcuts` e `urgent`.

### `KeyDecoder` e `readAllInput`

| Nome                           | O que é                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `new KeyDecoder().feed(texto)` | transforma o que o terminal mandou em teclas `{ key, pasted }`; guarda estado entre chamadas, para sequências partidas |
| `readAllInput()`               | todo o stdin, de uma vez, como texto: para um programa que recebe um pedido só (um hook)                               |

[↑ topo](#topo)

## Como funciona

### Terminal ou pipe

O `StdinReader` olha se o stdin é um terminal (`isTTY`):

|                             | Terminal (TTY)                                         | Pipe, arquivo, teste                  |
| --------------------------- | ------------------------------------------------------ | ------------------------------------- |
| como lê                     | **modo raw**: tecla por tecla, montando a linha        | linha a linha, como o sistema entrega |
| eco                         | escreve o que se digita (`write`), apaga com Backspace | não há eco                            |
| `choose`                    | uma tecla, sem Enter                                   | a primeira letra da próxima linha     |
| `instant`, atalhos, colagem | funcionam                                              | não se aplicam                        |

### A fila e o que fura a fila

No terminal, a leitura **continua** mesmo sem ninguém pedindo uma linha: uma mensagem digitada enquanto o agente trabalha entra numa fila e é entregue no próximo `next`. Duas coisas vão **na frente** dessa fila:

- a linha de um **atalho** (`shortcuts`), assim que a tecla é apertada;
- uma linha digitada que `urgent` reconhece.

Uma escolha (`choose`) pendente tem prioridade sobre a linha sendo digitada: a tecla vai para a escolha e não aparece na linha. Um texto colado nunca responde uma escolha.

### Teclas especiais

| Tecla                    | O que acontece                                                  |
| ------------------------ | --------------------------------------------------------------- |
| Enter                    | envia a linha (se não estiver colando)                          |
| Backspace                | apaga o último caractere visível (um emoji inteiro, não metade) |
| Ctrl+C                   | chama `onInterrupt` e fecha                                     |
| Ctrl+D                   | fecha a leitura; numa escolha, cancela só ela                   |
| setas, Home, F1…         | descartadas                                                     |
| um atalho de `shortcuts` | envia a linha dele, na frente                                   |

### Quem usa

| Quem                                  | Como                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TerminalInteraction` (`interaction`) | o terminal de quem roda um script ou um agente: `ask`, `listen` e `choose` são `next` e `choose`                                                           |
| o agente                              | cria o terminal com `AGENT_TERMINAL`: Ctrl+A vira `:approvals` (abre a tela de aprovações) e um comando de aprovações digitado vai na frente das mensagens |
| o hook do gate                        | lê o pedido da CLI com `readAllInput`                                                                                                                      |

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `agents/meus-testes/input-exemplos/` que roda como está, na raiz do repositório.

### 1. Tudo o que veio pelo stdin

`agents/meus-testes/input-exemplos/1-tudo.ts`:

```ts
/**
 * Exemplo 1 do curso de input: tudo o que chegou pelo stdin, de uma vez. É
 * como um hook recebe o pedido da CLI. Rode com algo canalizado:
 *
 *   printf '{"tool":"Bash","command":"ls"}' | bun agents/meus-testes/input-exemplos/1-tudo.ts
 */
import { readAllInput } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const request: unknown = JSON.parse(readAllInput());
writeOut(`recebido: ${JSON.stringify(request)}\n`);
```

`printf '{"tool":"Bash","command":"ls"}' | bun agents/meus-testes/input-exemplos/1-tudo.ts` (saída real):

```
recebido: {"tool":"Bash","command":"ls"}
```

### 2. Linha a linha, sem terminal

Sem terminal, o stdin de um programa é um pipe: quem o iniciou escreve as linhas, e o `StdinReader` lê uma por vez. Este exemplo faz as duas pontas sozinho, sem precisar de nada no shell: o arquivo inicia a si mesmo como leitor, pelo `Executor`, e manda três linhas pelo stdin dele. `agents/meus-testes/input-exemplos/2-linhas.ts`:

```ts
/**
 * Exemplo 2 do curso de input: linha a linha, sem terminal. Este arquivo é
 * dois programas:
 *
 * - sem argumentos, ele inicia a si mesmo como `leitor`, pelo Executor, e
 *   manda as linhas pelo stdin do leitor;
 * - como `leitor`, o stdin dele é um pipe, não um teclado: `next` devolve a
 *   próxima linha e `choose` a primeira letra dela, em minúscula.
 *
 *   bun agents/meus-testes/input-exemplos/2-linhas.ts
 */
import { Executor } from '../../../src/execute/index';
import {
  programArguments,
  runtimeExecutable,
} from '../../../src/execute/process';
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

if (programArguments()[0] === 'leitor') {
  const input = new StdinReader();

  writeOut(`next: ${JSON.stringify(await input.next())}\n`);
  writeOut(`next: ${JSON.stringify(await input.next())}\n`);
  writeOut(
    `choose(['s', 'n']): ${JSON.stringify(await input.choose(['s', 'n']))}\n`,
  );

  try {
    await input.next();
  } catch (error) {
    // O stdin acabou: não há mais linhas.
    const message = error instanceof Error ? error.message : String(error);
    writeOut(`next depois do fim: ${message}\n`);
  }
  input.close();
} else {
  // O mesmo arquivo, como leitor, com três linhas no stdin.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [new URL(import.meta.url).pathname, 'leitor'],
    input: 'olá\ntudo bem\nSim\n',
  })) {
    writeOut(chunk);
  }
}
```

`bun agents/meus-testes/input-exemplos/2-linhas.ts` (saída real):

```
next: "olá"
next: "tudo bem"
choose(['s', 'n']): "s"
next depois do fim: stdin foi fechado.
```

- O leitor não tem terminal: não há eco, nem modo raw, nem tecla única. Cada `next` é a próxima linha que chegou.
- O `choose` leu a linha `Sim` e devolveu a primeira letra, em minúscula.
- Quando o stdin acaba, um `next` a mais termina com erro, em vez de esperar para sempre.

É assim que o Goiaba é usado quando alguém (um teste, outro programa) fala com ele por um pipe.

### 3. Cancelar a espera

`agents/meus-testes/input-exemplos/3-cancelar.ts`:

```ts
/**
 * Exemplo 3 do curso de input: parar de esperar uma linha. Um AbortSignal
 * cancela o `next` (por exemplo, a resposta chegou por outro caminho).
 */
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const input = new StdinReader();
const controller = new AbortController();
setTimeout(() => {
  controller.abort();
}, 300);

try {
  await input.next(controller.signal);
} catch (error) {
  const name = error instanceof Error ? error.name : '?';
  const message = error instanceof Error ? error.message : String(error);
  writeOut(`${name}: ${message}\n`);
} finally {
  input.close();
}
```

Saída real (com `sleep 1 |` na frente, para o stdin ficar aberto sem mandar nada):

```
AbortError: A entrada foi cancelada.
```

### 4. O que o terminal manda vira teclas

`agents/meus-testes/input-exemplos/4-teclas.ts`:

```ts
/**
 * Exemplo 4 do curso de input: o que o terminal manda vira teclas. O
 * KeyDecoder não precisa de terminal: é só dar o texto. Ele marca o que foi
 * colado, descarta setas e outras sequências, e aguenta sequências partidas.
 */
import { KeyDecoder } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const ESC = '\u001b';
const show = (label: string, chunks: readonly string[]): void => {
  const decoder = new KeyDecoder();
  const keys = chunks.flatMap((chunk) => decoder.feed(chunk));
  writeOut(
    `${label.padEnd(30)} → ${keys.map(({ key, pasted }) => `${JSON.stringify(key)}${pasted ? '(colado)' : ''}`).join(' ')}\n`,
  );
};

show('digitado: ab + Enter', ['ab\r']);
show('seta para cima no meio', [`a${ESC}[Ab`]);
show('Alt+x', [`${ESC}x`]);
show('colado: a, quebra, b', [`${ESC}[200~a\nb${ESC}[201~`]);
show('a marca de colagem partida', [`${ESC}[2`, `00~xy${ESC}[2`, '01~z']);
show('Ctrl+A', ['\u0001']);
```

Saída real:

```
digitado: ab + Enter           → "a" "b" "\r"
seta para cima no meio         → "a" "b"
Alt+x                          → "x"
colado: a, quebra, b           → "a"(colado) "\n"(colado) "b"(colado)
a marca de colagem partida     → "x"(colado) "y"(colado) "z"
Ctrl+A                         → "\u0001"
```

- a seta (`ESC [ A`) sumiu: não virou `[A` no texto;
- o texto colado vem marcado, inclusive a quebra de linha, que por isso não envia;
- a marca de colagem chegou partida em três pedaços e ainda assim foi reconhecida: o `z`, depois do fim da colagem, já é digitado.

### 5. Num terminal de verdade

As opções em ação. `agents/meus-testes/input-exemplos/5-terminal.ts`:

```ts
/**
 * Exemplo 5 do curso de input: num terminal de verdade (TTY). O que o input
 * faz além de ler vem das opções: onde escrever o eco, o Ctrl+C, os atalhos
 * e as linhas urgentes. Rode no terminal e digite:
 *
 *   bun agents/meus-testes/input-exemplos/5-terminal.ts
 *
 *   1. "q" numa linha vazia: responde na hora, sem Enter (`instant`);
 *   2. "oi" e Enter;
 *   3. Ctrl+O: um atalho, que vira a linha ":menu";
 *   4. "s" para a escolha.
 */
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const input = new StdinReader({
  // Sem `write`, o terminal em modo raw não mostraria o que se digita.
  write: writeOut,
  onInterrupt: () => {
    writeOut('\n(Ctrl+C)\n');
  },
  shortcuts: { '\u000f': ':menu' }, // Ctrl+O
  urgent: (line) => line.startsWith(':'),
});

const say = (text: string): void => {
  writeOut(`\n[programa] ${text}\n`);
};

say('digite q (sem Enter):');
say(`recebeu ${JSON.stringify(await input.next(undefined, ['q']))}`);
say('digite oi e Enter:');
say(`recebeu ${JSON.stringify(await input.next())}`);
say('aperte Ctrl+O:');
say(`recebeu ${JSON.stringify(await input.next())}`);
say('s ou n?');
say(`recebeu ${JSON.stringify(await input.choose(['s', 'n']))}`);
input.close();
```

Saída real, digitando `q`, `oi` e Enter, Ctrl+O e `s`. (Para registrar aqui, o exemplo rodou num terminal falso, com o programa `script`, recebendo essas teclas.)

```
[programa] digite q (sem Enter):
q

[programa] recebeu "q"

[programa] digite oi e Enter:
oi

[programa] recebeu "oi"

[programa] aperte Ctrl+O:

[programa] recebeu ":menu"

[programa] s ou n?

[programa] recebeu "s"
```

- `q` foi a resposta na hora, sem Enter, porque estava em `instant`;
- `oi` apareceu enquanto era digitado graças ao `write`;
- Ctrl+O não virou texto: o atalho enviou `:menu`;
- `s` respondeu a escolha com uma tecla.

É o mesmo mecanismo que o agente usa: `AGENT_TERMINAL` registra o Ctrl+A como atalho para `:approvals`.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- **Ler o terminal.** Um segundo leitor do stdin rouba teclas: já travou um agente, quando um processo filho passou a ler o mesmo terminal. Quem precisa de uma resposta pede ao `StdinReader` (ou ao `TerminalInteraction`, que usa um).

**Ninguém deve:**

- **Criar dois `StdinReader` lendo o mesmo terminal.** É um por programa; o `TerminalInteraction` cria o dele.
- **Ensinar ao input o que uma linha significa.** O input não sabe o que é `:approvals`: quem sabe registra o atalho (`shortcuts`) e o que é urgente (`urgent`).
- **Esquecer o `write` num terminal.** Sem ele, nada do que se digita aparece, e um texto colado é enviado a cada quebra de linha.
- **Esquecer o `close`.** Enquanto o input está lendo, o terminal fica em modo raw e o programa não termina.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, o que o `choose(['s', 'n'])` devolve se a linha for `talvez`? E se for uma linha vazia? Por que, sem terminal, o `choose` não confere se a letra está entre as `keys`?

2. **Intermediário.** Mude o Exemplo 5 para que linhas começando com `!` também furem a fila, e registre o Ctrl+R como atalho para `:repetir`. O que acontece se você digitar `oi` (sem Enter) e então apertar Ctrl+R?

3. **Difícil.** O agente está trabalhando, e a pessoa digita `corrija o teste` e Enter, e depois `:approvals` e Enter. Seguindo `submit` e `urgent`, em que ordem as duas linhas chegam ao agente, e por quê? O que mudaria se o agente não passasse o `AGENT_TERMINAL` ao seu `TerminalInteraction`?

[↑ topo](#topo)
