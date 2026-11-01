<a id="topo"></a>

# Módulo filesystem: para que ele existe

Tudo o que o Goiaba faz no disco passa por aqui: ler e escrever arquivos, criar e apagar pastas, perguntar se um caminho existe, seguir um link simbólico. **Ninguém mais importa `node:fs`.** E os caminhos também: montar `pasta/arquivo`, resolver um relativo, descobrir o diretório pai. **Ninguém mais importa `node:path`.**

São funções pequenas, quase sempre uma linha sobre o Node. O valor não está nelas uma a uma, e sim em serem **o único lugar**:

- quando o Goiaba precisar mudar como acessa o disco (um disco virtual num teste, um registro de tudo o que é lido), muda só aqui;
- para saber o que o Goiaba toca no disco, basta procurar quem importa este módulo;
- a mesma regra vale para o resto do projeto: processos pelo `execute`, mensagens ao usuário pelo `output`.

O módulo **não depende de nenhum outro** do Goiaba. Nem do `process`: quando precisa do ambiente (o diretório de cache), recebe como parâmetro.

```
quem precisa do disco ──▶ filesystem ──▶ node:fs / node:path / node:os
(config, logger, store,      (o único)
 sandbox, agente, scripts)
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [Arquivos e pastas](#arquivos-e-pastas)
  - [Perguntar sobre um caminho](#perguntar-sobre-um-caminho)
  - [Caminhos como texto](#caminhos-como-texto)
  - [O cache do Goiaba](#o-cache-do-goiaba)
  - [Outros processos: `proc.ts`](#outros-processos-procts)
- [Como funciona](#como-funciona)
  - [O que lança e o que não lança](#o-que-lança-e-o-que-não-lança)
  - [O `mode` só vale ao criar](#o-mode-só-vale-ao-criar)
  - [Texto, não bytes](#texto-não-bytes)
- [Exemplos](#exemplos)
  - [1. Escrever, ler, listar e apagar](#1-escrever-ler-listar-e-apagar)
  - [2. Perguntar sobre um caminho](#2-perguntar-sobre-um-caminho)
  - [3. Caminhos como texto](#3-caminhos-como-texto)
  - [4. Links simbólicos](#4-links-simbólicos)
  - [5. Permissões](#5-permissões)
  - [6. O cache do Goiaba](#6-o-cache-do-goiaba)
  - [7. Outros processos pelo /proc](#7-outros-processos-pelo-proc)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo    | Papel                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | O disco (ler, escrever, listar, apagar, links), os caminhos como texto (reexportados de `node:path`) e o diretório de cache do Goiaba. |
| `proc.ts`  | Outros processos, lidos do `/proc` (Linux): nome, diretório, filhos, namespaces, se está vivo.                                         |

[↑ topo](#topo)

## Interface

### Arquivos e pastas

| Função                             | O que faz                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `readText(path)`                   | o conteúdo do arquivo, em UTF-8                                                                                             |
| `readDescriptor(fd)`               | tudo o que der para ler de um descritor aberto, como texto: `0` é o stdin (é assim que o `input` lê uma entrada canalizada) |
| `writeText(path, content, mode?)`  | escreve (cria ou substitui)                                                                                                 |
| `appendText(path, content, mode?)` | acrescenta no fim (cria se não existir)                                                                                     |
| `listDirectory(path)`              | os nomes dentro da pasta (sem o caminho, sem ordem garantida)                                                               |
| `ensureDirectory(path, mode?)`     | cria a pasta e as que faltarem no caminho; se já existe, nada                                                               |
| `removePath(path)`                 | apaga arquivo ou pasta inteira; se não existe, nada                                                                         |
| `createSymlink(target, path)`      | cria em `path` um link para `target`                                                                                        |

### Perguntar sobre um caminho

| Função              | Responde                                        | Se o caminho não existe |
| ------------------- | ----------------------------------------------- | ----------------------- |
| `pathExists(path)`  | existe?                                         | `false`                 |
| `canOpen(path)`     | este processo consegue abrir para ler?          | `false`                 |
| `isDirectory(path)` | é uma pasta? (segue links)                      | **lança**               |
| `isSymlink(path)`   | é um link simbólico? (não segue)                | **lança**               |
| `modifiedAt(path)`  | quando mudou por último, em milissegundos       | **lança**               |
| `readLink(path)`    | para onde o link aponta                         | **lança**               |
| `realPath(path)`    | o caminho absoluto, com todos os links seguidos | **lança**               |

### Caminhos como texto

Reexportados de `node:path`, **sem tocar no disco**: `join`, `resolve`, `relative`, `dirname`, `isAbsolute`, `normalize`, `sep`.

### O cache do Goiaba

| Função                | O que é                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `goiabaCacheDir(env)` | `$XDG_CACHE_HOME/goiaba`, ou `~/.cache/goiaba`. `env` é o ambiente de onde ler a variável: `environment()`, do `execute`, ou um objeto seu |

### Outros processos: `proc.ts`

| Função                        | O que é                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `processAlive(pid)`           | o processo existe?                                                     |
| `processName(pid)`            | o nome (`bun`, `bwrap`…), ou `undefined`                               |
| `processCwd(pid)`             | o diretório dele, ou `undefined`                                       |
| `processChildren(pid)`        | os pids dos filhos                                                     |
| `processNamespace(pid, tipo)` | o namespace (`net`, `mnt`, `user`…), ou `undefined`                    |
| `canEnterUserNamespace(pid)`  | este processo pode entrar no namespace de usuário dele (`nsenter -U`)? |

[↑ topo](#topo)

## Como funciona

### O que lança e o que não lança

São duas famílias, de propósito:

- **As que respondem sim ou não** (`pathExists`, `canOpen`) e **as que garantem um estado** (`ensureDirectory`, `removePath`) **nunca lançam** por causa de um caminho que não existe. Criar o que já existe ou apagar o que não existe não é erro.
- **As que leem algo do caminho** (`isDirectory`, `isSymlink`, `modifiedAt`, `readLink`, `realPath`, `readText`, `listDirectory`) **lançam** se ele não existe (`ENOENT`). Para perguntar com segurança: `pathExists(p) && isDirectory(p)`.

As funções de `proc.ts` seguem a primeira família: um processo que não existe (ou que sumiu no meio da leitura) dá `undefined`, `false` ou `[]`, nunca erro.

### O `mode` só vale ao criar

`ensureDirectory`, `writeText` e `appendText` aceitam um `mode` (as permissões, como `0o600`). Ele só vale **quando a pasta ou o arquivo é criado**: num que já existe, não muda nada. O Goiaba usa `0o700` e `0o600` para o que só o dono deve ler: o log, o cache, o diretório do gate.

### Texto, não bytes

`readText`, `writeText` e `appendText` trabalham com texto UTF-8. O Goiaba lê e escreve configuração, JSON, logs e Markdown; não há função para bytes.

[↑ topo](#topo)

## Exemplos

Cada exemplo é um arquivo de `agents/meus-testes/filesystem-exemplos/` que roda como está. Os que mexem no disco usam uma pasta temporária no cache do Goiaba e a apagam no fim.

### 1. Escrever, ler, listar e apagar

`agents/meus-testes/filesystem-exemplos/1-ler-escrever.ts`:

```ts
/**
 * Exemplo 1 do curso de filesystem: criar uma pasta, escrever, acrescentar,
 * ler, listar e apagar. Tudo numa pasta temporária, apagada no fim.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  listDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());

// Cria a pasta e as que faltarem no caminho.
ensureDirectory(join(dir, 'notas'));

writeText(join(dir, 'notas', 'hoje.txt'), 'primeira linha\n');
appendText(join(dir, 'notas', 'hoje.txt'), 'segunda linha\n');
writeText(join(dir, 'notas', 'amanha.txt'), 'nada ainda\n');

writeOut(
  `listDirectory: ${JSON.stringify(listDirectory(join(dir, 'notas')).toSorted())}\n`,
);
writeOut(`readText:\n${readText(join(dir, 'notas', 'hoje.txt'))}`);

// Apaga a árvore inteira; um caminho que não existe é ignorado.
removePath(dir);
removePath(dir);
writeOut(`depois de removePath, existe? ${String(pathExists(dir))}\n`);
```

Saída real:

```
listDirectory: ["amanha.txt","hoje.txt"]
readText:
primeira linha
segunda linha
depois de removePath, existe? false
```

O segundo `removePath` não reclamou: a pasta já não existia.

### 2. Perguntar sobre um caminho

`agents/meus-testes/filesystem-exemplos/2-perguntas.ts`:

```ts
/**
 * Exemplo 2 do curso de filesystem: perguntar sobre um caminho. Cuidado:
 * `isDirectory`, `isSymlink` e `modifiedAt` lançam se o caminho não existe;
 * `pathExists` e `canOpen` nunca lançam.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  canOpen,
  ensureDirectory,
  goiabaCacheDir,
  isDirectory,
  isSymlink,
  join,
  modifiedAt,
  pathExists,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());
ensureDirectory(dir);
const file = join(dir, 'arquivo.txt');
writeText(file, 'x');
const missing = join(dir, 'nao-existe');

try {
  writeOut(`pathExists(arquivo): ${String(pathExists(file))}\n`);
  writeOut(`isDirectory(pasta): ${String(isDirectory(dir))}\n`);
  writeOut(`isDirectory(arquivo): ${String(isDirectory(file))}\n`);
  writeOut(`isSymlink(arquivo): ${String(isSymlink(file))}\n`);
  writeOut(
    `modifiedAt(arquivo) é recente: ${String(Date.now() - modifiedAt(file) < 60_000)}\n`,
  );
  writeOut(`canOpen(arquivo): ${String(canOpen(file))}\n`);
  writeOut(`canOpen('/etc/shadow'): ${String(canOpen('/etc/shadow'))}\n`);

  writeOut(`pathExists(nao-existe): ${String(pathExists(missing))}\n`);
  try {
    isDirectory(missing);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? String(error.code) : '?';
    writeOut(`isDirectory(nao-existe): lança ${code}\n`);
  }
  // O jeito seguro: perguntar se existe antes.
  writeOut(
    `pathExists && isDirectory: ${String(pathExists(missing) && isDirectory(missing))}\n`,
  );
} finally {
  removePath(dir);
}
```

Saída real:

```
pathExists(arquivo): true
isDirectory(pasta): true
isDirectory(arquivo): false
isSymlink(arquivo): false
modifiedAt(arquivo) é recente: true
canOpen(arquivo): true
canOpen('/etc/shadow'): false
pathExists(nao-existe): false
isDirectory(nao-existe): lança ENOENT
pathExists && isDirectory: false
```

`canOpen('/etc/shadow')` é `false`: o arquivo existe, mas este processo não pode lê-lo. `isDirectory` de um caminho que não existe lança `ENOENT`; a última linha mostra o jeito seguro.

### 3. Caminhos como texto

`agents/meus-testes/filesystem-exemplos/3-caminhos.ts`:

```ts
/**
 * Exemplo 3 do curso de filesystem: caminhos como texto. Nenhuma destas
 * funções toca no disco; elas vêm daqui para ninguém importar node:path.
 */
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const show = (expression: string, value: unknown): void => {
  writeOut(`${expression.padEnd(48)} → ${JSON.stringify(value)}\n`);
};

show(
  "join('/projeto', 'src', 'index.ts')",
  join('/projeto', 'src', 'index.ts'),
);
show("join('/projeto', '../fora')", join('/projeto', '../fora'));
show("resolve('/projeto', 'src/../docs')", resolve('/projeto', 'src/../docs'));
show("resolve('/projeto', '/etc/passwd')", resolve('/projeto', '/etc/passwd'));
show(
  "relative('/projeto', '/projeto/src/a.ts')",
  relative('/projeto', '/projeto/src/a.ts'),
);
show(
  "relative('/projeto', '/outro/b.ts')",
  relative('/projeto', '/outro/b.ts'),
);
show("dirname('/projeto/src/index.ts')", dirname('/projeto/src/index.ts'));
show("isAbsolute('src/index.ts')", isAbsolute('src/index.ts'));
show(
  "normalize('/projeto//src/./a/../b.ts')",
  normalize('/projeto//src/./a/../b.ts'),
);
show('sep', sep);
```

Saída real:

```
join('/projeto', 'src', 'index.ts')              → "/projeto/src/index.ts"
join('/projeto', '../fora')                      → "/fora"
resolve('/projeto', 'src/../docs')               → "/projeto/docs"
resolve('/projeto', '/etc/passwd')               → "/etc/passwd"
relative('/projeto', '/projeto/src/a.ts')        → "src/a.ts"
relative('/projeto', '/outro/b.ts')              → "../outro/b.ts"
dirname('/projeto/src/index.ts')                 → "/projeto/src"
isAbsolute('src/index.ts')                       → false
normalize('/projeto//src/./a/../b.ts')           → "/projeto/src/b.ts"
sep                                              → "/"
```

Duas linhas pedem atenção: `join('/projeto', '../fora')` dá `/fora`, e `resolve('/projeto', '/etc/passwd')` dá `/etc/passwd`. Montar um caminho **não protege** contra sair da pasta: para isso, compare com `relative` (se começar com `..`, escapou), como a política de arquivos faz.

### 4. Links simbólicos

`agents/meus-testes/filesystem-exemplos/4-symlinks.ts`:

```ts
/**
 * Exemplo 4 do curso de filesystem: links simbólicos. `readLink` diz para
 * onde o link aponta; `realPath` segue todos até o arquivo de verdade. É
 * assim que a política de arquivos descobre um link que escapa do workspace.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  createSymlink,
  ensureDirectory,
  goiabaCacheDir,
  isSymlink,
  join,
  readLink,
  readText,
  realPath,
  relative,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());
const workspace = join(dir, 'workspace');
const outside = join(dir, 'fora');
ensureDirectory(workspace);
ensureDirectory(outside);
writeText(join(outside, 'segredo.txt'), 'não era para estar aqui\n');

// Um link dentro do workspace que aponta para fora dele.
const link = join(workspace, 'atalho.txt');
createSymlink(join(outside, 'segredo.txt'), link);

try {
  const hide = (path: string): string => path.replaceAll(dir, '<tmp>');
  writeOut(`isSymlink(atalho.txt): ${String(isSymlink(link))}\n`);
  writeOut(`readLink(atalho.txt): ${hide(readLink(link))}\n`);
  writeOut(`realPath(atalho.txt): ${hide(realPath(link))}\n`);
  writeOut(`readText(atalho.txt): ${readText(link)}`);

  // Dentro do workspace pelo caminho; fora, pelo arquivo de verdade.
  const escapes = relative(realPath(workspace), realPath(link)).startsWith(
    '..',
  );
  writeOut(`o arquivo de verdade está fora do workspace? ${String(escapes)}\n`);
} finally {
  removePath(dir);
}
```

Saída real:

```
isSymlink(atalho.txt): true
readLink(atalho.txt): <tmp>/fora/segredo.txt
realPath(atalho.txt): <tmp>/fora/segredo.txt
readText(atalho.txt): não era para estar aqui
o arquivo de verdade está fora do workspace? true
```

Pelo caminho, `atalho.txt` está dentro do workspace; pelo arquivo de verdade (`realPath`), está fora. É por isso que a política de arquivos recusa um caminho protegido que seja "um symlink externo".

### 5. Permissões

`agents/meus-testes/filesystem-exemplos/5-permissoes.ts` (para mostrar o `mode`, usa o programa `stat`, pelo `execute`):

```ts
/**
 * Exemplo 5 do curso de filesystem: o `mode` de pastas e arquivos. Vale só
 * quando o arquivo ou a pasta é criado. O Goiaba usa 0o700 e 0o600 para o
 * que só o dono deve ler (o log, o cache). Para mostrar o mode, o exemplo
 * pergunta ao `stat` (um programa auxiliar, pelo execute).
 */
import { randomUUID } from 'node:crypto';

import { environment, runProgram } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const dir = join(goiabaCacheDir(environment()), 'fs-exemplo', randomUUID());

const mode = async (path: string): Promise<string> =>
  (await runProgram('stat', ['-c', '%a', path], { timeoutMs: 5000 })).trim();

try {
  ensureDirectory(join(dir, 'privada'), 0o700);
  writeText(join(dir, 'privada', 'log.jsonl'), '{}\n', 0o600);
  writeText(join(dir, 'publico.txt'), 'oi\n');
  // Já existe: o mode passado agora não muda nada.
  appendText(join(dir, 'publico.txt'), 'de novo\n', 0o600);

  writeOut(`privada/          ${await mode(join(dir, 'privada'))}\n`);
  writeOut(
    `privada/log.jsonl ${await mode(join(dir, 'privada', 'log.jsonl'))}\n`,
  );
  writeOut(`publico.txt       ${await mode(join(dir, 'publico.txt'))}\n`);
} finally {
  removePath(dir);
}
```

Saída real:

```
privada/          700
privada/log.jsonl 600
publico.txt       664
```

`publico.txt` foi criado sem `mode` (o padrão do sistema, `664`); o `0o600` do `appendText` depois não mudou nada, porque o arquivo já existia.

### 6. O cache do Goiaba

`agents/meus-testes/filesystem-exemplos/6-cache.ts`:

```ts
/**
 * Exemplo 6 do curso de filesystem: onde o Goiaba guarda o que é dele. O
 * ambiente entra como parâmetro: o filesystem não lê o processo.
 */
import { environment } from '../../../src/execute/process';
import { goiabaCacheDir } from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const home = environment()['HOME'] ?? '';
const hide = (path: string): string => path.replace(home, '~');

writeOut(
  `com o ambiente do processo: ${hide(goiabaCacheDir(environment()))}\n`,
);
writeOut(
  `com XDG_CACHE_HOME=/var/cache: ${goiabaCacheDir({ XDG_CACHE_HOME: '/var/cache' })}\n`,
);
writeOut(
  `com XDG_CACHE_HOME vazio:     ${hide(goiabaCacheDir({ XDG_CACHE_HOME: '' }))}\n`,
);
```

Saída real:

```
com o ambiente do processo: ~/.cache/goiaba
com XDG_CACHE_HOME=/var/cache: /var/cache/goiaba
com XDG_CACHE_HOME vazio:     ~/.cache/goiaba
```

Como o ambiente é parâmetro, dá para perguntar "onde seria o cache com este ambiente" sem mudar o processo, que é o que um teste faz.

### 7. Outros processos pelo /proc

`agents/meus-testes/filesystem-exemplos/7-proc.ts`:

```ts
/**
 * Exemplo 7 do curso de filesystem: outros processos pelo /proc (Linux). O
 * /proc é uma visão do sistema em forma de arquivos; ler é disco, então
 * mora aqui. Quem usa: a sandbox, o lock do agente e o broker.
 */
import { currentDirectory, currentPid } from '../../../src/execute/process';
import {
  processAlive,
  processChildren,
  processCwd,
  processName,
  processNamespace,
} from '../../../src/filesystem/proc';
import { writeOut } from '../../../src/output/terminal';

const pid = currentPid();
writeOut(`processName(este): ${String(processName(pid))}\n`);
writeOut(
  `processCwd(este) é o diretório atual: ${String(processCwd(pid) === currentDirectory())}\n`,
);
writeOut(`processAlive(este): ${String(processAlive(pid))}\n`);
writeOut(`processAlive(999999): ${String(processAlive(999_999))}\n`);
writeOut(`processChildren(este): ${JSON.stringify(processChildren(pid))}\n`);
writeOut(
  `processNamespace(este, 'net') começa com net:[ ${String(processNamespace(pid, 'net')?.startsWith('net:['))}\n`,
);
```

Saída real:

```
processName(este): bun
processCwd(este) é o diretório atual: true
processAlive(este): true
processAlive(999999): false
processChildren(este): []
processNamespace(este, 'net') começa com net:[ true
```

O lock do agente usa `processAlive` e `processName` para saber se o agente que pegou o workspace ainda roda; a sandbox usa `processChildren` e `processNamespace` para achar a jaula.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- **Importar `node:fs`, `node:path`** (e o `homedir` de `node:os`). Quem precisa do disco ou de um caminho importa daqui.

**Ninguém deve:**

- **Chamar `isDirectory` (ou `readText`, `realPath`…) num caminho que talvez não exista** sem perguntar antes com `pathExists`: elas lançam.
- **Confiar em `join`/`resolve` para manter um caminho dentro de uma pasta.** Compare com `relative`, e use `realPath` quando houver links.
- **Esperar que o `mode` mude um arquivo que já existe.** Ele só vale ao criar.
- **Ler o ambiente aqui dentro.** Quem chama passa (`goiabaCacheDir(environment())`): o `filesystem` não depende do `execute`.

[↑ topo](#topo)

## Exercícios

1. **Simples.** O que acontece em cada linha, e por quê: `ensureDirectory('/tmp/a/b/c')` duas vezes seguidas; `removePath('/tmp/a')` duas vezes; `listDirectory('/tmp/a')` depois disso?

2. **Intermediário.** Escreva uma função `dentroDe(pasta, caminho): boolean` que diga se `caminho` fica dentro de `pasta`, **inclusive seguindo links**. Teste com `join(pasta, '../fora')` e com um link como o do Exemplo 4. Por que só `relative` (sem `realPath`) não basta?

3. **Difícil.** O log do Goiaba é criado com `0o600`. Um usuário cria antes, à mão, o arquivo do log com permissão `644`. Seguindo `appendText`, com que permissão o log fica, e por quê? Como o módulo poderia garantir o `600` mesmo assim, e que função nova isso pediria?

[↑ topo](#topo)
