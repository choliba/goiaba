<a id="topo"></a>

# Módulo cli: os comandos que o Goiaba oferece

O `src/cli` guarda **os comandos que o Goiaba oferece a quem o usa**: programas prontos, rodados com `bun run <nome>`, que fazem parte do produto. Hoje há um só, o **`approvals`**: a tela onde você vê os comandos e destinos que o gate negou e decide quais aprovar.

Eles são diferentes de `scripts/`, que são ferramentas de desenvolvimento **deste repositório** (abrir uma issue, limpar o log, gerar os cursos). Um comando do `cli` vale para qualquer projeto que use o Goiaba.

Cada comando é pequeno de propósito: ele **junta peças** que vivem em outros módulos, e não implementa nada por conta própria.

```
bun run approvals ──▶ runCommand (src/command)   lê os argumentos, carrega a config, trata o Ctrl+C
                          │
                          ├─▶ Store.open(getConfig().databasePath)   o banco do projeto (src/store)
                          └─▶ ApprovalReview(store, output).run(root)  a tela (src/approval)
```

## Índice

- [Visão geral](#visão-geral)
- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`bun run approvals`](#bun-run-approvals)
  - [As teclas da tela](#as-teclas-da-tela)
- [Como funciona](#como-funciona)
  - [Do comando à tela](#do-comando-à-tela)
  - [De onde vêm os pedidos](#de-onde-vêm-os-pedidos)
  - [O que uma aprovação faz](#o-que-uma-aprovação-faz)
  - [A mesma tela dentro do agente](#a-mesma-tela-dentro-do-agente)
- [Exemplos](#exemplos)
  - [1. A ajuda do comando](#1-a-ajuda-do-comando)
  - [2. Sem nada para aprovar](#2-sem-nada-para-aprovar)
  - [3. Aprovar um pedido](#3-aprovar-um-pedido)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Visão geral

- **O que é:** a tela de aprovações como um programa. Ela lista os pedidos negados pelo gate (comandos e destinos de rede), deixa marcar quais aprovar e salva a decisão.
- **Quando usar:** quando um agente parou esperando uma aprovação ("aguarda a aprovação de uma pessoa (pedido #N)"), ou para revisar o que foi negado.
- **Como chamar:** `bun run approvals`, ou `bun run approvals --root <dir>` para ver só um workspace.
- **Dentro de um agente rodando:** `Ctrl+A` abre a mesma tela, no mesmo terminal.
- **Depois de aprovar:** um agente rodando continua sozinho; um parado retoma a tarefa de onde parou quando for rodado de novo.

[↑ topo](#topo)

## Os arquivos

| Arquivo        | Papel                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `approvals.ts` | O comando `approvals`: declara a opção `--root`, abre o banco do projeto e roda a tela de aprovações. |

O que ele usa, e de onde:

| Peça                          | Módulo                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `defineCommand`, `runCommand` | `src/command`: argumentos, `--help`, config, log e Ctrl+C |
| `getConfig().databasePath`    | `src/config`: onde fica o banco do projeto                |
| `Store`                       | `src/store`: os pedidos negados e as aprovações           |
| `ApprovalReview`              | `src/approval`: a tela (tabela, seleção, aprovar)         |
| `resolve`                     | `src/filesystem`: o `--root` vira um caminho absoluto     |

[↑ topo](#topo)

## Interface

### `bun run approvals`

```
bun run approvals [--root <dir>]
```

| Opção          | O que faz                                                                                |
| -------------- | ---------------------------------------------------------------------------------------- |
| `--root <dir>` | mostra só os pedidos desse workspace (o caminho é resolvido a partir do diretório atual) |
| `-h`, `--help` | a ajuda                                                                                  |

Sem `--root`, mostra os pedidos de todos os workspaces do banco, agrupados por workspace.

### As teclas da tela

Na tabela:

| Resposta                                                          | O que faz                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| um número (`3`), vários (`1,3,4`) ou um intervalo (`1-5`) + Enter | marca ou desmarca esses pedidos                                        |
| `a`                                                               | marca ou desmarca todos                                                |
| Enter (vazio)                                                     | mostra a tabela de novo, com pedidos novos de um agente que ainda roda |
| `r`                                                               | avança com os marcados                                                 |
| `q`                                                               | sai sem salvar                                                         |

Depois de `r`, como aprovar:

| Tecla          | O que faz                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `u` (ou Enter) | aprova **uma vez**: o comando exato, na próxima tentativa                                       |
| `w`            | aprova **neste workspace**, para sempre: o padrão do comando (`npm install left-pad` → `npm *`) |
| `d`            | **descarta**: não aprova, e o pedido some da lista                                              |
| `q`            | cancela, sem salvar                                                                             |

Num terminal, `a`, `r`, `q` e as teclas de aprovação respondem sem Enter.

[↑ topo](#topo)

## Como funciona

### Do comando à tela

1. O `runCommand` lê os argumentos (`--root`) e, sem erro de uso, carrega o `goiaba.config.ts` **do diretório onde o comando roda** e abre o log.
2. O comando abre o banco em `getConfig().databasePath`.
3. A `ApprovalReview` mostra a tabela e conversa pela `Interaction` do comando (o terminal, por padrão).
4. No fim, o banco é fechado, aprovado ou não.

### De onde vêm os pedidos

Quando um comando ou um destino de rede cai no `default: 'deny'` da política, o gate **grava um pedido pendente** no banco e responde ao agente "aguarda a aprovação de uma pessoa (pedido #N)". É essa lista que a tela mostra. Uma negação por uma regra `deny` escrita **não** vira pedido: aprovação nenhuma passa por cima dela.

### O que uma aprovação faz

A tela grava a aprovação no banco e marca o pedido como respondido. Quem estiver esperando lê o banco:

- **o agente rodando** confere o banco de tempos em tempos (a cada segundo) e, ao achar a aprovação, manda o modelo rodar o comando de novo;
- **um agente parado** encontra a aprovação na próxima vez que rodar e retoma a sessão de onde parou.

Por isso a tela e o agente podem estar em **processos diferentes**: o banco é o ponto de encontro.

### A mesma tela dentro do agente

Num agente rodando, `Ctrl+A` (o atalho do `AGENT_SHORTCUTS`) abre a mesma `ApprovalReview`, **no mesmo processo e no mesmo terminal**. Rodar `bun run approvals` em outro terminal também funciona, mas nunca dois leitores no mesmo terminal: a tela usa a conversa do agente em vez de abrir outra.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `agents/meus-testes/cli-exemplos/` que roda como está: ele roda o comando de verdade, como um programa, pelo `Executor`. Os exemplos 2 e 3 criam um projeto temporário, com o banco próprio, e o apagam no fim.

### 1. A ajuda do comando

`agents/meus-testes/cli-exemplos/1-ajuda.ts`:

```ts
/**
 * Exemplo 1 do curso de cli: o comando `approvals` e a ajuda dele. O
 * exemplo roda o comando como um programa, pelo Executor, e mostra a saída.
 *
 *   bun agents/meus-testes/cli-exemplos/1-ajuda.ts
 */
import { Executor } from '../../../src/execute/index';
import { runtimeExecutable } from '../../../src/execute/process';
import { stdioOutput } from '../../../src/output/index';

const approvals = new URL('../../../src/cli/approvals.ts', import.meta.url)
  .pathname;

for await (const { chunk } of new Executor().run({
  executable: runtimeExecutable(),
  arguments: [approvals, '--help'],
})) {
  stdioOutput.write(chunk.trimEnd());
}
```

Saída real:

```
Uso: bun run approvals [opções]

Lista os comandos negados pelo gate e deixa selecionar e aprovar.

Opções:
      --root <dir>  Workspace cujas negações mostrar
  -h, --help        Mostra esta ajuda
```

A ajuda é gerada pelo `src/command` a partir da declaração do comando.

### 2. Sem nada para aprovar

`agents/meus-testes/cli-exemplos/2-sem-pedidos.ts`:

```ts
/**
 * Exemplo 2 do curso de cli: sem nada para aprovar. O comando lê o banco do
 * projeto onde roda (o `database` do goiaba.config.ts); um projeto novo não
 * tem pedidos. Cria um projeto temporário, roda o comando nele e apaga.
 *
 *   bun agents/meus-testes/cli-exemplos/2-sem-pedidos.ts
 */
import { randomUUID } from 'node:crypto';

import { Executor } from '../../../src/execute/index';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { stdioOutput } from '../../../src/output/index';

const approvals = new URL('../../../src/cli/approvals.ts', import.meta.url)
  .pathname;
const project = join(
  goiabaCacheDir(environment()),
  'cli-exemplo',
  randomUUID(),
);
ensureDirectory(project);
writeText(
  join(project, 'goiaba.config.ts'),
  `export default { database: { dir: 'db' } };\n`,
);

try {
  // O comando roda dentro do projeto: é de lá que ele lê a config e o banco.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [approvals],
    cwd: project,
  })) {
    stdioOutput.write(chunk.trimEnd());
  }
} finally {
  removePath(project);
}
```

Saída real:

```
Nenhum comando negado.
```

O comando rodou dentro do projeto temporário e leu o banco dele (`db/goiaba.db`), que ainda não tinha pedidos.

### 3. Aprovar um pedido

`agents/meus-testes/cli-exemplos/3-aprovar.ts`:

```ts
/**
 * Exemplo 3 do curso de cli: aprovar um pedido. O exemplo grava no banco de
 * um projeto temporário dois pedidos negados (como o gate faria), roda o
 * comando respondendo pelo stdin (`1`, `r`, `w`: marca o primeiro, avança,
 * aprova para o workspace) e mostra o que ficou no banco.
 *
 *   bun agents/meus-testes/cli-exemplos/3-aprovar.ts
 */
import { randomUUID } from 'node:crypto';

import { Executor } from '../../../src/execute/index';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { stdioOutput } from '../../../src/output/index';
import { Store } from '../../../src/store/index';

const approvals = new URL('../../../src/cli/approvals.ts', import.meta.url)
  .pathname;
const project = join(
  goiabaCacheDir(environment()),
  'cli-exemplo',
  randomUUID(),
);
ensureDirectory(project);
writeText(
  join(project, 'goiaba.config.ts'),
  `export default { database: { dir: 'db' } };\n`,
);
const databasePath = join(project, 'db', 'goiaba.db');
const workspace = '/projeto/app';

// O que o gate grava quando o `default` nega: um pedido pendente.
const store = Store.open(databasePath);
for (const command of ['npm install left-pad', 'curl https://exemplo.com']) {
  store.recordDecision({
    session: 'sessao-1',
    provider: 'claude',
    root: workspace,
    command,
    decision: 'deny',
    source: 'default',
    reason: 'Nenhuma regra corresponde à ação.',
  });
}
store.close();

try {
  // Sem terminal, a tela lê uma linha por resposta.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [approvals, '--root', workspace],
    cwd: project,
    input: '1\nr\nw\n',
  })) {
    stdioOutput.write(
      chunk.trimEnd().replaceAll(/\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<horário>'),
    );
  }

  const after = Store.open(databasePath);
  stdioOutput.write('\n--- no banco, depois:');
  for (const approval of after.activeApprovals(workspace)) {
    stdioOutput.write(`aprovação: ${approval.kind} "${approval.pattern}"`);
  }
  for (const pending of after.deniedDecisions(workspace)) {
    stdioOutput.write(`ainda pendente: ${pending.command}`);
  }
  after.close();
} finally {
  removePath(project);
}
```

Saída real (sem terminal, cada resposta é uma linha do stdin: `1`, `r`, `w`):

```

workspace: /projeto/app
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    Nº  ID     SEL  SESSÃO    HORÁRIO         COMANDO
  ────  ─────  ───  ────────  ──────────────  ─────────────────────────────────────────────────────────────────────────
    1:  #2     [ ]  sessao-1  <horário>  curl https://exemplo.com
    2:  #1     [ ]  sessao-1  <horário>  npm install left-pad

Opções:
número
[1 ou 3 ou 4]
[enter]

números separados por vírgula
[1,3,4,2 ou 3,2]
[enter]

range de números
[1-5 ou 2-4]
[enter]

[a] marca/desmarca todos

[r] avança

[q] sair sem salvar

Update>>

workspace: /projeto/app
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    Nº  ID     SEL  SESSÃO    HORÁRIO         COMANDO
  ────  ─────  ───  ────────  ──────────────  ─────────────────────────────────────────────────────────────────────────
    1:  #2     [x]  sessao-1  <horário>  curl https://exemplo.com
    2:  #1     [ ]  sessao-1  <horário>  npm install left-pad

Opções:
número
[1 ou 3 ou 4]
[enter]

números separados por vírgula
[1,3,4,2 ou 3,2]
[enter]

range de números
[1-5 ou 2-4]
[enter]

[a] marca/desmarca todos

[r] avança

[q] sair sem salvar

Update>>

Selecionados:

  #2  curl https://exemplo.com

Aprovar como:
[q] cancelar  (sair sem salvar)
[u] uma vez (comando exato)
[w] sempre neste workspace (padrão do comando)
[d] descartar (não aprova; some da lista)
w
✔ Aprovado (#2): curl *

Aprovações salvas. O agente em execução continua sozinho; se ele não estiver rodando, rode-o de novo e ele retoma de onde parou.

--- no banco, depois:
aprovação: workspace "curl *"
ainda pendente: npm install left-pad
```

- A tabela numera os pedidos do mais novo ao mais antigo; o `1` marcou o `curl` (veja o `[x]` na segunda tabela).
- Com `w`, o que ficou aprovado foi o **padrão** `curl *`, não o comando exato: no workspace, qualquer `curl` passa daqui em diante.
- O `npm install left-pad`, que não foi marcado, continua pendente.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- Ser um comando do produto: o que vai em `bun run <nome>` para quem usa o Goiaba. Ferramenta do repositório vai em `scripts/`.

**Ninguém deve:**

- **Pôr lógica num comando.** Um comando junta peças; a tela é do `src/approval`, o banco do `src/store`, os argumentos do `src/command`. Um comando novo segue o mesmo jeito: `defineCommand` + `runCommand`, e o trabalho num módulo.
- **Ler argumentos, escrever na tela ou abrir o banco por fora** desses módulos.
- **Abrir a tela de aprovações num segundo leitor do mesmo terminal.** Dentro de um agente, é o `Ctrl+A`.

[↑ topo](#topo)

## Exercícios

1. **Simples.** No Exemplo 3, troque a resposta `w` por `u`. O que fica gravado como aprovação, e o que muda para a próxima vez que o agente tentar `curl https://outro.com`?

2. **Intermediário.** Rode o Exemplo 3 respondendo `a`, `r` e `d`. O que a tela mostra, e o que fica no banco? Por que um pedido descartado que o agente tenta de novo vira um pedido **novo**?

3. **Difícil.** Um agente está rodando e esperando a aprovação do pedido #2 quando você o aprova com `bun run approvals` em outro terminal. Seguindo o que o agente faz enquanto espera (a consulta ao banco), descreva o caminho até o modelo rodar o comando de novo. Por que o banco, e não um evento, é o canal entre os dois?

[↑ topo](#topo)
