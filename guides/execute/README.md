<a id="topo"></a>

# Módulo execute: para que ele existe

Rodar um programa tem detalhes que ninguém deveria resolver duas vezes: passar os argumentos sem um shell no meio, ler stdout e stderr enquanto o programa roda, parar quando pedem, e transformar um programa que falhou num erro que dá para tratar. No Goiaba, **um programa só roda por aqui**.

O centro do módulo é o **`Executor`**: ele recebe um **`ProgramCommand`** (o programa, os argumentos, a entrada) e devolve **o que o programa imprime**, em pedaços, à medida que imprime.

```ts
for await (const { channel, chunk } of new Executor().run({
  executable: 'ls',
  arguments: ['-la'],
})) {
  // channel: 'stdout' ou 'stderr'; chunk: o texto que chegou
}
```

Ele **não conhece mais nada**: não sabe o que é uma sandbox, um provider, um agente. Isso é de propósito, para ele poder ser usado sozinho. O que dá sentido à execução vem de fora, por composição:

```
                ProgramCommand
  (você, ou o workspace embrulhando na sandbox)
                      │
                      ▼
                  Executor.run ──── signal, onStart, onAbort
                      │
                      ▼
            ProgramOutput (pedaços)
  (você, ou o parseOutput de um provider, dá sentido)
```

Além do `Executor`, o módulo tem o **processo atual** e os **programas auxiliares** do Goiaba (`process.ts`), e o **Ctrl+C** como um `AbortSignal` (`interrupt.ts`).

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [O Executor](#o-executor)
  - [Acompanhar execuções: `OutputDispatcher`](#acompanhar-execuções-outputdispatcher)
  - [O processo atual e programas auxiliares](#o-processo-atual-e-programas-auxiliares)
- [Como funciona](#como-funciona)
  - [Uma execução do começo ao fim](#uma-execução-do-começo-ao-fim)
  - [Falhas](#falhas)
  - [Cancelar](#cancelar)
  - [Composição: sandbox e provider](#composição-sandbox-e-provider)
- [Exemplos](#exemplos)
  - [1. Rodar um programa](#1-rodar-um-programa)
  - [2. Quando o programa falha](#2-quando-o-programa-falha)
  - [3. Cancelar](#3-cancelar)
  - [4. Dar sentido à saída](#4-dar-sentido-à-saída)
  - [5. Dentro de uma sandbox](#5-dentro-de-uma-sandbox)
  - [6. Acompanhar várias execuções](#6-acompanhar-várias-execuções)
  - [7. O processo atual e o Ctrl+C](#7-o-processo-atual-e-o-ctrlc)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo        | Papel                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`     | `ProgramCommand` (o que rodar) e `ProgramOutput` (um pedaço da saída).                                                                                                                   |
| `index.ts`     | `Executor`, `ProgramExecutionError` e o log de cada execução (`command`, em `debug`: fases `spawn` e `exit`).                                                                            |
| `stream.ts`    | `OutputStream` (uma fila lida com `for await`) e `OutputDispatcher` (uma sequência por execução, e quem acompanha todas).                                                                |
| `process.ts`   | O único lugar que toca em `process`: argumentos, ambiente, diretório, pid, código de saída, erros não capturados e os programas auxiliares (`runProgram`, `startHelper`, `runAttached`). |
| `interrupt.ts` | `listenForInterrupt`: o primeiro Ctrl+C aborta um `AbortSignal`; um segundo força a saída.                                                                                               |

O módulo depende só do **logger**, que registra cada execução. Inspecionar outros processos pelo `/proc` e o diretório de cache do Goiaba (`goiabaCacheDir`) são do `filesystem`.

[↑ topo](#topo)

## Interface

### O Executor

| Membro                                                | O que faz                                                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `new Executor({ createExecutionId?, spawnProcess? })` | `createExecutionId`: o id de cada execução no log (padrão: UUID); `spawnProcess`: como iniciar o processo (para testes) |
| `run(command, options?)`                              | inicia o programa e devolve um `AsyncGenerator<ProgramOutput>`                                                          |
| `ProgramExecutionError`                               | o programa terminou com código diferente de zero, ou por sinal: `executable`, `code`, `signal`                          |

`command` (`ProgramCommand`):

| Campo        | O que é                                                        |
| ------------ | -------------------------------------------------------------- |
| `executable` | o programa                                                     |
| `arguments?` | os argumentos, cada um como está (sem shell)                   |
| `cwd?`       | o diretório onde ele roda                                      |
| `input?`     | o que vai para o stdin                                         |
| `env?`       | o ambiente **inteiro** do programa; sem ele, herda o do Goiaba |

`options` (`RunOptions`):

| Opção           | O que é                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `signal?`       | abortar mata o programa e termina a execução com o motivo                      |
| `onStart?(pid)` | o programa começou (uma sandbox pode inspecioná-lo); uma falha aqui é ignorada |
| `onAbort?()`    | além de matar o programa no abort, o que mais desfazer (derrubar uma sandbox)  |
| `logFields?`    | campos a mais nos registros de log desta execução                              |

### Acompanhar execuções: `OutputDispatcher`

Para quando várias execuções correm ao mesmo tempo e alguém quer ver todas:

| Membro                                   | O que faz                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `open(executionId, programId)`           | abre a sequência de uma execução e a devolve                               |
| `publish(executionId, programId, value)` | entrega `value` a essa sequência **e** a quem assinou                      |
| `close(...)`, `fail(..., error)`         | termina a sequência, bem ou com erro                                       |
| `subscribe()`                            | a sequência de **todas** as execuções: `{ executionId, programId, value }` |

### O processo atual e programas auxiliares

| Função                                                          | O que é                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `programArguments()`                                            | os argumentos do programa, sem o runtime e o script                                           |
| `environment()`, `setEnvironmentDefault(nome, valor)`           | o ambiente; o segundo só define se ainda não existir                                          |
| `currentDirectory()`, `currentPid()`, `parentPid()`             | o processo atual                                                                              |
| `exitProgram(code)`, `setExitCode(code)`, `onUncaughtError(fn)` | como o programa termina                                                                       |
| `runProgram(exe, args, { timeoutMs })`                          | roda um programa **curto** e devolve o stdout inteiro                                         |
| `startHelper(exe, args, { cwd })`                               | inicia um programa **de longa duração** (o guardião da jaula, o bridge de rede), com `stop()` |
| `runAttached(exe, args)`                                        | passa o terminal a outro programa e devolve o código dele                                     |
| `listenForInterrupt()`                                          | Ctrl+C como `{ signal, dispose() }`                                                           |
| `interruptProgram()`                                            | manda o Ctrl+C para este programa (o terminal em modo raw não manda)                          |

[↑ topo](#topo)

## Como funciona

### Uma execução do começo ao fim

1. `run` registra no log a fase `spawn` e **inicia** o processo, sem shell (`shell: false`: os argumentos vão como estão, nada é interpretado) e com o `env` do comando, se houver.
2. Começa a ouvir stdout, stderr e erro **na hora**: um erro ao iniciar acontece antes de alguém ler, e não pode se perder.
3. Chama `onStart(pid)`, escreve o `input` no stdin e o fecha.
4. **Entrega cada pedaço** de stdout e stderr, na ordem em que chegam.
5. Quando o programa termina, registra a fase `exit` (código, sinal, duração em nanossegundos) e encerra, ou lança.
6. Se quem lê sair antes do fim (um `break`), o programa é parado: ninguém mais quer a saída dele.

### Falhas

| O que acontece                                | O que o `for await` recebe                                      |
| --------------------------------------------- | --------------------------------------------------------------- |
| código 0                                      | termina normalmente                                             |
| código diferente de 0, ou morto por sinal     | `ProgramExecutionError`, **depois** da saída que o programa deu |
| o programa não pôde ser iniciado (não existe) | o erro do sistema                                               |

### Cancelar

Com `signal`, abortar faz o Executor mandar `SIGTERM` ao processo, `SIGKILL` 2 segundos depois se ele não sair, e chamar `onAbort`. O `for await` termina com **o motivo** do abort, não com um `ProgramExecutionError`, mesmo que o programa tenha morrido por sinal.

### Composição: sandbox e provider

O Executor não sabe de sandbox nem de provider; quem precisa deles compõe:

| Peça        | Papel                                                                                                                                                             | Onde                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| o workspace | `workspace.prepare(command)` **embrulha** o comando na sandbox (no bubblewrap, um `nsenter` que entra na jaula); `onStart` e `onAbort` ligam a sandbox à execução | antes e em volta do `run` |
| um provider | `createCommand` diz o que rodar; `parseOutput` transforma os pedaços em eventos (`output`, `ask`, `session`…)                                                     | antes e depois do `run`   |
| o agente    | junta os três em `runProvider` (`src/agent/run-provider.ts`), e publica os eventos num `OutputDispatcher`                                                         |                           |

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `agents/meus-testes/execute-exemplos/` que roda como está, na raiz do repositório. Só o Exemplo 5 precisa do bubblewrap.

### 1. Rodar um programa

`agents/meus-testes/execute-exemplos/1-rodar.ts`:

```ts
/**
 * Exemplo 1 do curso de execute: rodar um programa. Só o Executor e um
 * ProgramCommand: sem sandbox, sem provider. A saída chega em pedaços, com
 * o canal (stdout ou stderr) de cada um.
 */
import { Executor } from '../../../src/execute/index';
import { writeOut } from '../../../src/output/stdio';

const executor = new Executor();

for await (const { channel, chunk } of executor.run({
  executable: 'printf',
  arguments: ['%s\n', 'olá', 'tudo certo'],
})) {
  writeOut(`${channel}: ${JSON.stringify(chunk)}\n`);
}

// Com entrada: `input` vai para o stdin do programa.
for await (const { chunk } of executor.run({
  executable: 'tr',
  arguments: ['a-z', 'A-Z'],
  input: 'gritando',
})) {
  writeOut(`tr: ${chunk}\n`);
}
```

Saída real:

```
stdout: "olá\ntudo certo\n"
tr: GRITANDO
```

O `printf` imprimiu as duas linhas de uma vez: chegou **um** pedaço com as duas.

### 2. Quando o programa falha

`agents/meus-testes/execute-exemplos/2-erros.ts`:

```ts
/**
 * Exemplo 2 do curso de execute: quando o programa falha. Código diferente
 * de zero vira ProgramExecutionError, depois da saída que o programa deu; um
 * programa que não existe, o erro do sistema.
 */
import { Executor, ProgramExecutionError } from '../../../src/execute/index';
import type { ProgramCommand } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';

const executor = new Executor();
const commands: readonly ProgramCommand[] = [
  { executable: 'ls', arguments: ['package.json'] },
  { executable: 'ls', arguments: ['nao-existe'] },
  { executable: 'programa-que-nao-existe' },
];

for (const command of commands) {
  writeOut(`${[command.executable, ...(command.arguments ?? [])].join(' ')}\n`);
  try {
    for await (const { channel, chunk } of executor.run(command)) {
      writeOut(`  ${channel}: ${chunk.trim()}\n`);
    }
    writeOut('  terminou bem\n');
  } catch (error) {
    const kind =
      error instanceof ProgramExecutionError
        ? `ProgramExecutionError (code ${String(error.code)})`
        : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    writeOut(`  ${kind}: ${message}\n`);
  }
}
```

Saída real:

```
ls package.json
  stdout: package.json
  terminou bem
ls nao-existe
  stderr: ls: cannot access 'nao-existe': No such file or directory
  ProgramExecutionError (code 2): O programa ls terminou com código 2.
programa-que-nao-existe
  Error: Executable not found in $PATH: "programa-que-nao-existe"
```

- `ls nao-existe`: a mensagem do `ls` chegou (em **dois** pedaços), e só depois o `ProgramExecutionError`, com o nome do programa e o código.
- `programa-que-nao-existe`: não chega a rodar; é o erro do sistema, não um `ProgramExecutionError`.

### 3. Cancelar

`agents/meus-testes/execute-exemplos/3-cancelar.ts`:

```ts
/**
 * Exemplo 3 do curso de execute: parar um programa. Abortar o signal manda
 * SIGTERM (e SIGKILL depois de 2 s), chama `onAbort` e termina o `for await`
 * com o motivo do abort.
 */
import { Executor } from '../../../src/execute/index';
import { writeOut } from '../../../src/output/stdio';

const controller = new AbortController();
setTimeout(() => {
  controller.abort(new Error('Cancelado: demorou demais.'));
}, 500);

const startedAt = performance.now();
try {
  for await (const { chunk } of new Executor().run(
    { executable: 'sleep', arguments: ['30'] },
    {
      signal: controller.signal,
      onAbort: () => {
        writeOut('onAbort: hora de desfazer o que mais estiver de pé\n');
      },
    },
  )) {
    writeOut(chunk);
  }
} catch (error) {
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  const message = error instanceof Error ? error.message : String(error);
  writeOut(`parou em ~${seconds} s: ${message}\n`);
}
```

Saída real:

```
onAbort: hora de desfazer o que mais estiver de pé
parou em ~0.5 s: Cancelado: demorou demais.
```

O `sleep 30` parou em meio segundo; `onAbort` rodou; o erro é o motivo passado ao `abort`.

### 4. Dar sentido à saída

O Executor entrega pedaços; o sentido é de quem lê. Este é o papel de um `parseOutput` de provider. `agents/meus-testes/execute-exemplos/4-ler-saida.ts`:

```ts
/**
 * Exemplo 4 do curso de execute: dar sentido à saída. O Executor entrega
 * pedaços do tamanho que o sistema quiser; quem lê junta até o fim de cada
 * linha antes de interpretar. É o papel de um `parseOutput` de provider.
 */
import { Executor } from '../../../src/execute/index';
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';

/** Linhas inteiras do stdout, por mais partida que a saída chegue. */
async function* lines(
  output: AsyncIterable<ProgramOutput>,
): AsyncIterable<string> {
  let pending = '';
  for await (const { channel, chunk } of output) {
    if (channel !== 'stdout') continue;
    const parts = (pending + chunk).split('\n');
    pending = parts.pop() ?? '';
    yield* parts;
  }
  // O que veio depois do último \n também é uma linha.
  if (pending !== '') yield pending;
}

// Um programa que escreve uma linha em três pedaços, com pausas.
const program = {
  executable: process.execPath,
  arguments: [
    '-e',
    `const write = (text, ms) => new Promise(r => setTimeout(() => { process.stdout.write(text); r(); }, ms));
     await write('pri', 50); await write('meira\\nsegu', 50); await write('nda', 50);`,
  ],
};

let chunks = 0;
const counted = async function* (output: AsyncIterable<ProgramOutput>) {
  for await (const value of output) {
    chunks += 1;
    yield value;
  }
};

for await (const line of lines(counted(new Executor().run(program)))) {
  writeOut(`linha: ${JSON.stringify(line)}\n`);
}
writeOut(`(chegaram ${String(chunks)} pedaços)\n`);
```

Saída real:

```
linha: "primeira"
linha: "segunda"
(chegaram 3 pedaços)
```

O programa escreveu `pri`, `meira\nsegu` e `nda`: três pedaços que não respeitam as linhas. `lines` juntou e entregou as duas linhas inteiras.

### 5. Dentro de uma sandbox

O mesmo Executor, com um comando preparado pelo workspace. `agents/meus-testes/execute-exemplos/5-sandbox.ts`:

```ts
/**
 * Exemplo 5 do curso de execute: o mesmo Executor, dentro de uma sandbox.
 * O execute não conhece workspace: quem compõe prepara o comando (o
 * workspace o embrulha na jaula) e passa os ganchos. Precisa do bubblewrap;
 * rode na raiz do repositório.
 */
import { Executor } from '../../../src/execute/index';
import { currentDirectory } from '../../../src/execute/process';
import { writeOut } from '../../../src/output/stdio';
import { Workspace } from '../../../src/workspace/index';

const workspace = new Workspace({
  type: 'bubblewrap',
  root: currentDirectory(),
});
const inner = {
  executable: 'sh',
  arguments: ['-c', 'echo "dentro: $(pwd)"; ls -d /home 2>&1'],
};

try {
  // O workspace embrulha: o programa vira um nsenter que entra na jaula.
  const command = await workspace.prepare(inner);
  writeOut(
    `o que roda de fato: ${command.executable} ${String(command.arguments?.length)} argumentos\n`,
  );

  for await (const { chunk } of new Executor().run(command, {
    onStart: (pid) => workspace.sandbox.started?.(pid),
    onAbort: () => void workspace.close(),
  })) {
    writeOut(chunk.replaceAll(currentDirectory(), '<raiz>'));
  }
} finally {
  await workspace.close();
}
```

Saída real:

```
o que roda de fato: nsenter 13 argumentos
dentro: <raiz>
/home
```

O Executor rodou um `nsenter`, sem saber que era uma jaula. Por isso, numa sandbox, um `ProgramExecutionError` fala do `nsenter`: o motivo real está no stderr que o programa deixou.

### 6. Acompanhar várias execuções

`agents/meus-testes/execute-exemplos/6-acompanhar.ts`:

```ts
/**
 * Exemplo 6 do curso de execute: acompanhar várias execuções. O
 * OutputDispatcher guarda uma sequência por execução e entrega todas a quem
 * assina, com o id da execução e de quem a pediu.
 */
import { Executor, OutputDispatcher } from '../../../src/execute/index';
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';

const dispatcher = new OutputDispatcher<ProgramOutput>();
const executor = new Executor();

// O observador: assina antes e lê em paralelo, sem saber quem roda o quê.
void (async () => {
  for await (const {
    executionId,
    programId,
    value,
  } of dispatcher.subscribe()) {
    writeOut(
      `  [observador] ${executionId} (${programId}): ${value.chunk.trim()}\n`,
    );
  }
})();

/** Roda e publica cada pedaço; quem chamou lê a sequência da sua execução. */
async function run(
  executionId: string,
  programId: string,
  text: string,
): Promise<void> {
  const own = dispatcher.open(executionId, programId);
  void (async () => {
    for await (const chunk of executor.run({
      executable: 'echo',
      arguments: [text],
    })) {
      dispatcher.publish(executionId, programId, chunk);
    }
    dispatcher.close(executionId, programId);
  })();
  for await (const { chunk } of own)
    writeOut(`[${executionId}] ${chunk.trim()}\n`);
}

await run('execucao-1', 'eco', 'primeira');
await run('execucao-2', 'eco', 'segunda');
```

Saída real:

```
[execucao-1] primeira
  [observador] execucao-1 (eco): primeira
[execucao-2] segunda
  [observador] execucao-2 (eco): segunda
```

Cada pedaço chega a quem pediu a execução **e** ao observador, que sabe de qual execução veio. É o que o agente faz com os eventos do provider (`runProvider`), para quem passar um `output` nas opções dele.

### 7. O processo atual e o Ctrl+C

Sem Executor: as outras partes do módulo. `agents/meus-testes/execute-exemplos/7-processo.ts`, rodado com dois argumentos (`bun agents/meus-testes/execute-exemplos/7-processo.ts a b`):

```ts
/**
 * Exemplo 7 do curso de execute: o processo atual e programas auxiliares
 * (process.ts) e Ctrl+C como AbortSignal (interrupt.ts). Nada aqui usa o
 * Executor. Para olhar o próprio processo, o /proc é lido pelo filesystem
 * (src/filesystem/proc.ts), não pelo execute.
 */
import { listenForInterrupt } from '../../../src/execute/interrupt';
import { processAlive, processName } from '../../../src/filesystem/proc';
import {
  currentPid,
  environment,
  interruptProgram,
  programArguments,
  runProgram,
} from '../../../src/execute/process';
import { writeOut } from '../../../src/output/stdio';

// O processo atual, sem tocar em `process` direto.
writeOut(`argumentos: ${JSON.stringify(programArguments())}\n`);
writeOut(`HOME definido: ${String(environment()['HOME'] !== undefined)}\n`);
writeOut(
  `este processo: ${processName(currentPid()) ?? '?'}, vivo: ${String(processAlive(currentPid()))}\n`,
);

// Um programa auxiliar curto: espera terminar e devolve a saída.
const kernel = await runProgram('uname', ['-s'], { timeoutMs: 5000 });
writeOut(`uname -s: ${kernel.trim()}\n`);

// Ctrl+C vira um AbortSignal; aqui o próprio programa se manda o SIGINT.
const interrupt = listenForInterrupt();
interrupt.signal.addEventListener('abort', () => {
  writeOut('Ctrl+C recebido: o trabalho pode limpar e parar\n');
});
interruptProgram();
await new Promise((resolve) => setTimeout(resolve, 50));
writeOut(`signal.aborted: ${String(interrupt.signal.aborted)}\n`);
interrupt.dispose();
```

Saída real:

```
argumentos: ["a","b"]
HOME definido: true
este processo: bun, vivo: true
uname -s: Linux
Ctrl+C recebido: o trabalho pode limpar e parar
signal.aborted: true
```

`interruptProgram()` faz o que um Ctrl+C faria: em modo raw, o terminal não manda o `SIGINT`, e quem lê as teclas chama esta função.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- **Iniciar programas.** Ninguém mais importa `child_process`: o Executor para programas que você acompanha; `runProgram`, `startHelper` e `runAttached` para os auxiliares do Goiaba.
- **Tocar em `process`.** Argumentos, ambiente, diretório, sinais e código de saída passam por `process.ts`.

**Ninguém deve:**

- **Montar uma linha de shell.** `{ executable: 'ls', arguments: ['-la', pasta] }`, nunca `'ls -la ' + pasta`. O que precisar de shell (pipe, redirecionamento) é um `sh -c` explícito.
- **Interpretar a saída por pedaço.** O tamanho do pedaço é do sistema: junte até o fim da linha (ou do JSON) antes.
- **Esperar que o Executor conheça a sandbox.** Prepare o comando com o workspace antes, e passe `onStart`/`onAbort`.
- **Usar `runProgram` para um programa que precisa de sandbox ou de acompanhamento.** Ele espera terminar e devolve tudo de uma vez; é para auxiliares curtos.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 1, troque `printf` por `sh -c 'echo um; echo dois >&2'`. Quantos pedaços chegam e de quais canais? A ordem entre eles é garantida?

2. **Intermediário.** No Exemplo 4, o que `lines` entrega se o programa terminar com `'fim'` sem `\n` no final? E se o programa escrever no stderr: a linha aparece? Altere `lines` para entregar `{ channel, line }`, juntando cada canal separadamente.

3. **Difícil.** No Exemplo 3, troque `sleep 30` por um programa que ignora o `SIGTERM` (`sh -c 'trap "" TERM; sleep 30'`). Seguindo `terminate` em `index.ts`, quanto tempo o `for await` leva para terminar, e por quê? O erro ainda é o motivo do abort?

[↑ topo](#topo)
