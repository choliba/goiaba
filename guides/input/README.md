<a id="topo"></a>

# Módulo input: para que ele existe

Todo processo nasce com um **stdin**: o canal por onde chega o que alguém digita, o que veio por um pipe (`echo oi | bun …`) ou o que a CLI manda para um hook. O módulo `input` é **o único leitor do stdin**, e só faz isso: entrega o que chegou, como texto, **inteiro** ou **em pedaços**.

O que o texto quer dizer (uma tecla, uma linha, uma mensagem, um comando) não é assunto dele. Isso é dos [adapters](../adapters/README.md), que leem o stdin por aqui e transformam o que chega em eventos para a [conversa](../interaction/README.md).

```
stdin (teclado, pipe, arquivo) ──▶ input ──▶ read():       o texto inteiro, quando o stdin acaba
                                         └─▶ readStream(): os pedaços, conforme chegam
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
- [Como funciona](#como-funciona)
  - [Inteiro ou em pedaços](#inteiro-ou-em-pedaços)
  - [Abre só quando alguém lê](#abre-só-quando-alguém-lê)
  - [O fim, o erro e a desistência](#o-fim-o-erro-e-a-desistência)
  - [Um leitor só](#um-leitor-só)
  - [O modo raw](#o-modo-raw)
- [Exemplos](#exemplos)
  - [1. Tudo o que veio pelo stdin](#1-tudo-o-que-veio-pelo-stdin)
  - [2. Em pedaços](#2-em-pedaços)
  - [3. Parar de ler](#3-parar-de-ler)
  - [4. Um leitor só](#4-um-leitor-só)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo    | Papel                                                  |
| ---------- | ------------------------------------------------------ |
| `index.ts` | `read`, `readStream` e `stdinIsTty`: a fonte do stdin. |

O módulo não depende de nenhum outro para ler. Usa o `execute/process.ts` (o dono do `process`) só para registrar, com `onProgramExit`, que o modo raw seja desfeito quando o programa terminar.

[↑ topo](#topo)

## Interface

| Função                    | O que faz                                                                   |
| ------------------------- | --------------------------------------------------------------------------- |
| `read(): Promise<string>` | tudo o que o stdin tem, quando ele acaba (EOF)                              |
| `readStream(options?)`    | um `AsyncIterable<string>`: os pedaços, conforme chegam, até o stdin acabar |
| `stdinIsTty(): boolean`   | se o stdin é um terminal (alguém digitando) e não um pipe ou um arquivo     |

As opções do `readStream`:

| Opção    | O que faz                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `raw`    | num terminal, cada tecla na hora, sem o eco nem a edição de linha do terminal; ignorada fora de um terminal |
| `signal` | encerra o stream: a leitura para, o stdin é devolvido e quem lê recebe um `AbortError`                      |

[↑ topo](#topo)

## Como funciona

### Inteiro ou em pedaços

Os dois modos leem a **mesma fonte**: `read()` é o `readStream()` juntado até o fim. Os dois são assíncronos: esperar o stdin nunca trava o processo (o Ctrl+C, os timers e o resto continuam).

- **Inteiro** serve a quem recebe um pedido completo: o hook de aprovação lê o JSON da CLI com `await read()`.
- **Em pedaços** serve a quem precisa reagir enquanto o texto chega: um adapter que lê teclas, ou linhas de um pipe que não acaba.

Um pedaço não é uma linha: o sistema decide o tamanho. Juntar os pedaços em linhas é do adapter (`records`, no [stdio](../adapters/README.md)).

### Abre só quando alguém lê

Chamar `readStream()` não abre nada: o stdin só começa a ser lido no primeiro `next()` (o primeiro passo do `for await`). Um programa que cria um leitor e nunca lê não fica preso esperando entrada.

### O fim, o erro e a desistência

O fim é o do próprio `AsyncIterable`, sem evento à parte:

- **o stdin acabou** (EOF; num pipe, quando quem escreve fecha): o `for await` termina;
- **erro**: a exceção aparece dentro do `for await`, como um `throw`;
- **quem lê desiste** (`break`, `return`, ou o `signal`): a leitura para e o stdin é devolvido.

### Um leitor só

Um byte do stdin não pode ir para dois leitores: um segundo `readStream()` **ao mesmo tempo** é recusado com um `UsageError`. Depois que o primeiro termina, ler de novo é permitido (e, se o stdin já acabou, termina na hora).

### O modo raw

Num terminal, o normal é o próprio terminal juntar as teclas em linhas, mostrar o que se digita e entregar só depois do Enter. Com `raw: true`, cada tecla chega na hora, sem eco: é o que um adapter precisa para editar a linha, aceitar uma escolha de uma tecla ou rolar a tela. O modo raw é desfeito quando o stream termina, e também quando o programa termina no meio (`onProgramExit`), para o terminal nunca ficar quebrado.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `guides/input/exemplos/` que roda como está, na raiz do repositório, com o stdin indicado.

### 1. Tudo o que veio pelo stdin

`guides/input/exemplos/1-tudo.ts`:

```ts
/**
 * Exemplo 1 do curso de input: tudo o que veio pelo stdin, de uma vez. É o
 * caso de quem recebe um pedido inteiro, como o hook de aprovação recebe o
 * JSON da CLI: `read()` espera o stdin acabar e devolve o texto.
 */
import { read } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const request: unknown = JSON.parse(await read());
const command =
  typeof request === 'object' &&
  request !== null &&
  'tool_input' in request &&
  typeof request.tool_input === 'object' &&
  request.tool_input !== null &&
  'command' in request.tool_input
    ? request.tool_input.command
    : undefined;

writeOut(`a CLI quer rodar: ${String(command)}\n`);
```

Com um pedido no stdin (`printf '{"tool_input":{"command":"ls -la"}}' | bun guides/input/exemplos/1-tudo.ts`):

```
a CLI quer rodar: ls -la
```

### 2. Em pedaços

`guides/input/exemplos/2-pedacos.ts`:

```ts
/**
 * Exemplo 2 do curso de input: o stdin em pedaços, conforme chegam. Quem
 * decide o tamanho de cada pedaço é o sistema, não o conteúdo: um pedaço
 * pode ter várias linhas, ou o fim de uma e o começo de outra.
 */
import { readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

let count = 0;
for await (const piece of readStream()) {
  count += 1;
  writeOut(`pedaço ${String(count)}: ${JSON.stringify(piece)}\n`);
}
writeOut(`o stdin acabou depois de ${String(count)} pedaço(s)\n`);
```

Com duas linhas num pipe (`printf 'um\ndois\n' | bun guides/input/exemplos/2-pedacos.ts`):

```
pedaço 1: "um\ndois\n"
o stdin acabou depois de 1 pedaço(s)
```

As duas linhas chegaram num pedaço só: quem precisa de linhas junta e separa (`records`, nos adapters).

### 3. Parar de ler

`guides/input/exemplos/3-cancelar.ts`:

```ts
/**
 * Exemplo 3 do curso de input: parar de ler. O `signal` encerra o stream:
 * a leitura para, o stdin é devolvido e o `for await` recebe um AbortError.
 * Aqui, ninguém escreve nada no stdin, e desistimos depois de 100 ms.
 */
import { readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const controller = new AbortController();
setTimeout(() => {
  controller.abort();
}, 100);

try {
  for await (const piece of readStream({ signal: controller.signal })) {
    writeOut(`chegou: ${piece}\n`);
  }
} catch (error) {
  writeOut(`parou: ${error instanceof Error ? error.name : String(error)}\n`);
}
```

Com um stdin que fica aberto sem mandar nada (`sleep 1 | bun guides/input/exemplos/3-cancelar.ts`):

```
parou: AbortError
```

### 4. Um leitor só

`guides/input/exemplos/4-um-leitor.ts`:

```ts
/**
 * Exemplo 4 do curso de input: o stdin tem um leitor só. Um segundo
 * `readStream()` ao mesmo tempo é recusado com um UsageError, para que um
 * byte nunca vá para dois leitores. Depois que o primeiro acaba, ler de
 * novo termina na hora: não há mais nada.
 */
import { UsageError } from '../../../src/errors';
import { read, readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const first = readStream()[Symbol.asyncIterator]();
const reading = first.next();

try {
  await readStream()[Symbol.asyncIterator]().next();
} catch (error) {
  if (error instanceof UsageError)
    writeOut(`segundo leitor: ${error.message}\n`);
}

writeOut(`o primeiro leu: ${JSON.stringify((await reading).value)}\n`);
await first.return(undefined);
writeOut(`o resto: ${JSON.stringify(await read())}\n`);
writeOut(`de novo: ${JSON.stringify(await read())}\n`);
```

`echo oi | bun guides/input/exemplos/4-um-leitor.ts`:

```
segundo leitor: O stdin já está sendo lido: ele tem um leitor só por vez.
o primeiro leu: "oi\n"
o resto: ""
de novo: ""
```

[↑ topo](#topo)

## Regras do módulo

- **Ninguém mais lê o stdin.** Nem `process.stdin`, nem `readline`, nem `readFileSync(0)`: tudo passa por `read` ou `readStream`. Um leitor a mais já travou um agente (as teclas iam para o leitor errado).
- **Só a fonte.** Teclas, linhas, eco, atalhos e o que uma mensagem significa ficam nos adapters e na conversa.
- **Os dois modos são assíncronos.** Quem só tem um jeito síncrono de ler embrulha isso dentro de si; para fora, tudo se espera com `await`.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 2, rode com `(echo um; sleep 1; echo dois) | bun guides/input/exemplos/2-pedacos.ts`. Quantos pedaços chegam agora, e por quê?
2. **Médio.** Escreva um exemplo que conta as linhas do stdin usando `readStream` e o `records` de `src/adapters/stdio`. O que acontece com uma última linha sem `\n`?
3. **Avançado.** No Exemplo 3, troque o `setTimeout` por um `break` depois do primeiro pedaço e rode com `yes | bun …`. O programa termina? O que o `break` faz com o stdin?

[↑ topo](#topo)
