<a id="topo"></a>

# Módulo policy: para que ele existe

Uma **`AgentPolicy`** é um objeto que descreve permissões: o que pode, o que precisa de aprovação e o que nunca pode, em oito categorias (arquivos, web, rede, comandos, ferramentas, subagentes, comunicação e segredos). É **dado, não código**: não executa nada, não abre arquivo, não conhece agente nem sandbox. Pode ser escrita num arquivo, guardada, comparada, validada e consultada.

O módulo `policy` é o dono desse objeto. Ele define **a forma** (o tipo `AgentPolicy`) e **o significado**: dada uma política e uma ação, qual é a decisão.

```ts
import { PolicyEngine, type AgentPolicy } from '../src/policy/index';

// 1. Uma política: só dados.
const policy: AgentPolicy = {
  default: 'deny',
  allow: { execution: [{ commands: ['git *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
};

// 2. Perguntar o que ela diz sobre uma ação. Nenhum agente envolvido.
new PolicyEngine(policy).check({
  category: 'execution',
  command: 'git status',
});
// { policy: 'allow', source: 'allow', rule: { commands: ['git *'] },
//   reason: 'A ação corresponde a permissions.allow.execution.' }
```

Quem **aplica** uma política é outro assunto: a sandbox, os gates, a CLI de um provider. O agente é o leitor mais comum, mas não o único: um script, um teste ou uma ferramenta de revisão podem ler a mesma política.

```
                          AgentPolicy  (dados)
                                │
     ┌──────────────────┬───────┴──────────┬──────────────────────┐
     ▼                  ▼                  ▼                      ▼
PolicyEngine     compileFilesystem   networkRulesOf       delegatedCategories
check(ação)      Access(política)    (do network)         (o que só um
checkCommand     → montagens da      → regras de rede     provider traduz)
(linha)          sandbox
```

## Índice

- [AgentPolicy em uma página](#agentpolicy-em-uma-página)
- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [O modelo: `AgentPolicy`](#o-modelo-agentpolicy)
  - [Classes e funções](#classes-e-funções)
  - [Tipos](#tipos)
- [Como funciona](#como-funciona)
  - [Quem vence: deny, requireApproval, allow, default](#quem-vence-deny-requireapproval-allow-default)
  - [Os três tipos de padrão](#os-três-tipos-de-padrão)
  - [Uma linha de comando inteira: `checkCommand`](#uma-linha-de-comando-inteira-checkcommand)
  - [Arquivos viram sandbox: `compileFilesystemAccess`](#arquivos-viram-sandbox-compilefilesystemaccess)
  - [Quem aplica cada categoria](#quem-aplica-cada-categoria)
- [Exemplos](#exemplos)
  - [1. Uma ação: `check`](#1-uma-ação-check)
  - [2. Uma linha de shell: `checkCommand`](#2-uma-linha-de-shell-checkcommand)
  - [2b. Quando a resposta é `require_approval`: `authorize`](#2b-quando-a-resposta-é-require_approval-authorize)
  - [3. Aprovações salvas valem como allow](#3-aprovações-salvas-valem-como-allow)
  - [4. A política de arquivos vira montagens da sandbox](#4-a-política-de-arquivos-vira-montagens-da-sandbox)
  - [5. O que fica para o provider](#5-o-que-fica-para-o-provider)
  - [6. A mesma política num agente](#6-a-mesma-política-num-agente)
  - [7. Tools](#7-tools)
    - [A política](#a-política-das-ferramentas)
    - [O formato de uma ferramenta](#o-formato-de-uma-ferramenta)
    - [Ferramenta: ler email (`email/read`)](#ferramenta-ler-email-emailread)
    - [Ferramenta: enviar email (`email/send`)](#ferramenta-enviar-email-emailsend)
    - [Ferramenta: ler arquivo (`files/read`)](#ferramenta-ler-arquivo-filesread)
    - [O registro e a chamada](#o-registro-e-a-chamada)
    - [Rodando](#rodando)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## AgentPolicy em uma página

Uma política completa, lida em voz alta:

```ts
const policy: AgentPolicy = {
  // O que nenhuma regra cobre: aqui, nega.
  default: 'deny',

  // Liberado sem perguntar.
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/.env'] },
      },
    ],
    execution: [{ commands: ['bun *', 'git status', 'git diff *'] }],
    network: [
      {
        operations: ['connect'],
        hosts: ['registry.npmjs.org', '*.github.com'],
      },
    ],
    secrets: [{ operations: ['read'], secrets: ['NODE_ENV'] }],
  },

  // Pergunta antes.
  requireApproval: {
    execution: [{ commands: ['git commit *', 'rm *'] }],
  },

  // Nunca, nem com aprovação.
  deny: {
    execution: [{ commands: ['sudo *', 'rm -rf *'] }],
    network: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
  },
};
```

- **Quatro chaves, sempre as mesmas:** `default` e os três grupos (`allow`, `requireApproval`, `deny`). Cada grupo é opcional.
- **Dentro de cada grupo, as categorias.** Uma categoria só aparece onde há regra para ela.
- **Cada regra tem a mesma forma:** o que fazer (`operations`), sobre o quê (os alvos: `paths`, `commands`, `hosts`…) e o que fica de fora (`ignores`).
- **Quem vence** quando mais de uma regra casa: `deny`, depois `requireApproval`, depois `allow`; sem nenhuma, o `default`.

Algumas perguntas a esta política, e as respostas:

| Ação                             | Decisão            | Por quê                                |
| -------------------------------- | ------------------ | -------------------------------------- |
| rodar `bun test`                 | `allow`            | `bun *` em `allow.execution`           |
| rodar `rm build.log`             | `require_approval` | `rm *` em `requireApproval`            |
| rodar `rm -rf dist`              | `deny`             | `rm -rf *` em `deny`, que vence `rm *` |
| rodar `curl x.com`               | `deny` (`default`) | nenhuma regra de `execution` casa      |
| ler `NODE_ENV`                   | `allow`            | `allow.secrets`                        |
| ler `GITHUB_TOKEN`               | `deny` (`default`) | não está em nenhuma regra de `secrets` |
| conectar em `api.github.com:443` | `allow`            | `*.github.com` em `allow.network`      |

A política é a mesma não importa quem a lê: o motor responde igual para um agente, um teste ou um script.

[↑ topo](#topo)

## Os arquivos

| Arquivo               | Papel                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy.interface.ts` | **O modelo**: `AgentPolicy`, uma regra para cada categoria (`FilesystemRule`, `ExecutionRule`…), a ação a decidir (`AgentAction`) e a decisão (`PolicyDecision`). `NetworkRule` vem do módulo `network`, que é dono do que ela significa. |
| `index.ts`            | **As decisões**: `PolicyEngine` (`check`, `checkCommand`), `compileFilesystemAccess` (arquivos → sandbox) e `delegatedCategories` (o que a sandbox não aplica). Valida a política ao criar o motor.                                       |
| `command.ts`          | **Linhas de shell**: `parseCommand` (quebra em comandos simples, percebe redirecionamento e substituição), `commandMatches` (um padrão como `git *`) e `suggestPattern` (`mkdir -p x` → `mkdir *`).                                       |
| `wildmatch.ts`        | **Padrões de caminho**, no estilo do Git: `*`, `**`, `?`, `[a-z]`, escape. Usado por arquivos, domínios, ferramentas, segredos e, pelo `network`, hosts.                                                                                  |

[↑ topo](#topo)

## Interface

O que `src/policy/index.ts` exporta.

### O modelo: `AgentPolicy`

```ts
interface AgentPolicy {
  default: 'allow' | 'deny' | 'require_approval'; // o que nenhuma regra cobre
  allow?: PolicyGroups; // liberado sem perguntar
  requireApproval?: PolicyGroups; // pergunta antes
  deny?: PolicyGroups; // nunca, nem com aprovação
}

interface PolicyGroups {
  filesystem?: FilesystemRule[]; // paths
  web?: WebRule[]; // domains
  network?: NetworkRule[]; // hosts
  execution?: ExecutionRule[]; // commands
  tools?: ToolRule[]; // tools
  agents?: SubagentRule[]; // agents
  communication?: CommunicationRule[]; // channels
  secrets?: SecretRule[]; // secrets
}
```

Toda regra tem a mesma forma: `operations` (o que fazer), os **alvos** (o campo da categoria) e `ignores` para tirar alvos da regra. A exceção é `execution`, que só tem `commands`: nenhuma CLI sabe a intenção de um comando, então não há operação.

| Categoria       | Alvos                           | Operações                                                           |
| --------------- | ------------------------------- | ------------------------------------------------------------------- |
| `filesystem`    | `paths`                         | `read`, `write`                                                     |
| `web`           | `domains`                       | `search`, `read_text`, `interact`, `form_submit`, `login`, `browse` |
| `network`       | `hosts`                         | `connect`                                                           |
| `execution`     | `commands`                      | —                                                                   |
| `tools`         | `tools` (`servidor/ferramenta`) | `call`                                                              |
| `agents`        | `agents` (nome ou modelo)       | `spawn`                                                             |
| `communication` | `channels`                      | `send_email`, `post_social_media`, `send_logs`                      |
| `secrets`       | `secrets` (nomes de variáveis)  | `read`                                                              |

`'*'` em `operations` vale para todas.

### Classes e funções

| Nome                                       | Recebe                                               | Devolve                                                                                |
| ------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `new PolicyEngine(policy)`                 | uma `AgentPolicy` (validada aqui)                    | o motor                                                                                |
| `engine.check(action)`                     | uma `AgentAction`                                    | `PolicyDecision`: `{ policy, source, rule?, reason }`                                  |
| `engine.checkCommand(line, { approved? })` | uma linha de shell e, opcional, padrões já aprovados | `PolicyDecision` da linha inteira                                                      |
| `engine.authorize(action, approve?)`       | uma ação e quem pergunta (`ApprovalHandler`)         | `Promise<boolean>`: decide e, só em `require_approval`, pergunta                       |
| `compileFilesystemAccess(policy, root)`    | a política e a raiz do workspace                     | `FilesystemAccess`: como a sandbox monta os arquivos                                   |
| `delegatedCategories(policy)`              | a política                                           | as categorias com regra que só o provider aplica (`web`, `execution`, `communication`) |
| `suggestPattern(command)`                  | um comando                                           | o padrão que uma aprovação ampla salvaria                                              |
| `wildmatch(value, pattern)`                | um valor e um padrão                                 | `boolean`                                                                              |
| `NO_RULE_REASON`                           | —                                                    | o motivo de uma decisão pelo `default`                                                 |

### Tipos

| Tipo               | Forma                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentAction`      | uma ação, por categoria: `{ category: 'execution', command }`, `{ category: 'filesystem', operation, path }`, `{ category: 'secrets', operation, secret }`… |
| `PolicyDecision`   | `{ policy: 'allow' \| 'deny' \| 'require_approval', source: 'allow' \| 'requireApproval' \| 'deny' \| 'default' \| 'approved', rule?, reason }`             |
| `FilesystemAccess` | `{ workspaceAccess: 'readonly' \| 'readwrite', writable: string[], masks: FilesystemMask[] }`                                                               |
| `FilesystemMask`   | `{ path, access: 'readonly' \| 'hidden' }`                                                                                                                  |
| `PolicyCategory`   | o nome de uma das oito categorias                                                                                                                           |

[↑ topo](#topo)

## Como funciona

### Quem vence: deny, requireApproval, allow, default

Para uma ação, `check` procura uma regra que case em cada grupo, nesta ordem: `allow`, `requireApproval`, `deny`. **O último grupo que casou vence**, então:

```
deny  >  requireApproval  >  allow  >  default
```

Uma regra casa quando as três coisas valem: a operação está em `operations` (ou é `'*'`), o alvo casa com algum padrão, e não casa com nenhum de `ignores`.

`ignores` tira o alvo **daquela regra**, não da política: outra regra ainda pode casar. É assim que `requireApproval: hosts ['*'], ignores ['*.google.com']` deixa o Google de fora da pergunta, e ele cai no `default`.

### Os três tipos de padrão

| Categoria   | Padrão                                       | `*`                                              | Exemplo                          |
| ----------- | -------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `execution` | de comando (`commandMatches`)                | **qualquer coisa**, inclusive espaço e `/`       | `npm *` casa com `npm i ./a/b`   |
| `network`   | de host (`hostMatches`, do módulo `network`) | dentro do nome; `host` sem porta vale para todas | `*.github.com`, `localhost:3000` |
| as demais   | de caminho (`wildmatch`, estilo Git)         | não passa de `/`; `**` passa                     | `/workspace/src/**`, `*_TOKEN`   |

Um padrão de comando só aceita texto e `*`: `?`, `[` e `\` são recusados, porque não teriam sentido numa linha de shell.

### Uma linha de comando inteira: `checkCommand`

Um agente não roda "um comando", roda uma **linha**: `ls src && bun test`, `cat a | head`, `echo x > out.txt`. `checkCommand`:

1. **Quebra a linha** (`parseCommand`) nos comandos simples, separados por `&&`, `||`, `;` e `|`, respeitando aspas.
2. **Decide cada parte** com `check`. Vence a mais restritiva; empatado, uma regra escrita vence o `default`.
3. **Desconfia do que não dá para ler.** Se a linha tem redirecionamento (`>`, `<`), substituição (`$(…)`, crases), heredoc, `&` ou várias linhas, um `allow` vira `require_approval`: o efeito não está nas partes.
4. **Aplica os padrões aprovados** (`approved`), se houver: valem como `allow` acima de `requireApproval` e do `default`, mas nunca acima de um `deny`.

### Arquivos viram sandbox: `compileFilesystemAccess`

A política de arquivos não é decidida ação por ação: ela vira **como a sandbox monta o workspace**, antes do agente começar. Por isso é mais restrita que as outras:

- `default` precisa ser `deny`;
- `allow` precisa de `read` em `/workspace/**` (ler é o workspace inteiro ou nada);
- `write` em `/workspace/**` deixa o workspace gravável; `write` só numa pasta literal (`/workspace/guides/**`) deixa o resto só leitura e essa pasta gravável;
- `ignores` do `allow` e regras `deny` viram **máscaras**: um caminho escondido (`hidden`) ou só leitura (`readonly`);
- `requireApproval` de arquivos é recusado: não há como interceptar uma escrita com segurança.

Os caminhos usam `/workspace` como apelido da raiz (o caminho real também é aceito). Um caminho que escapa do workspace, ou um symlink que leva para fora, é recusado.

### Quem aplica cada categoria

| Categoria              | Quem aplica                         | Como                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------ |
| `filesystem`           | a sandbox                           | `compileFilesystemAccess` → montagens e máscaras       |
| `network`              | o módulo `network`                  | `networkRulesOf` → gate e proxy                        |
| `execution`            | o gate de comandos (`src/approval`) | `checkCommand`, por um hook na CLI                     |
| `secrets`              | o agente, ao montar a sandbox       | `check` em cada variável: só as liberadas entram       |
| `web`, `communication` | a CLI do provider                   | `delegatedCategories` → cada provider traduz ou recusa |
| `tools`, `agents`      | ninguém, ainda                      | o agente recusa a política se tiver essas regras       |

[↑ topo](#topo)

## Exemplos

### 1. Uma ação: `check`

`agents/meus-testes/policy-exemplos/1-check.ts`:

```ts
/** Exemplo 1 do curso de policy: a decisão de uma ação (`check`). */
import { writeOut } from '../../../src/output/terminal';
import { PolicyEngine } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

for (const command of [
  'git status',
  'git push origin main',
  'git push --force origin main',
  'rm -rf build',
]) {
  const { policy: decision, source } = policy.check({
    category: 'execution',
    command,
  });
  writeOut(`${command} → ${decision} (${source})\n`);
}
```

`bun agents/meus-testes/policy-exemplos/1-check.ts` (saída real):

```
git status → allow (allow)
git push origin main → require_approval (requireApproval)
git push --force origin main → deny (deny)
rm -rf build → deny (default)
```

| Comando                        | Por quê                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `git status`                   | só `git *` casa                                               |
| `git push origin main`         | `git *` e `git push *` casam; `requireApproval` vence `allow` |
| `git push --force origin main` | os três casam; `deny` vence                                   |
| `rm -rf build`                 | nenhuma regra casa: vale o `default`                          |

### 2. Uma linha de shell: `checkCommand`

`agents/meus-testes/policy-exemplos/2-check-command.ts`:

```ts
/** Exemplo 2 do curso de policy: uma linha de shell inteira (`checkCommand`). */
import { writeOut } from '../../../src/output/terminal';
import { PolicyEngine } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

for (const line of ['ls src && bun test', 'ls src && rm x', 'ls > out.txt']) {
  const { policy: decision, source, reason } = policy.checkCommand(line);
  writeOut(`${line} → ${decision} (${source}): ${reason}\n`);
}
```

Saída real:

```
ls src && bun test → allow (allow): A ação corresponde a permissions.allow.execution.
ls src && rm x → deny (default): Nenhuma regra corresponde à ação.
ls > out.txt → require_approval (allow): O comando tem redirecionamento, substituição ou script: o efeito não é verificável pela regra.
```

| Linha                | Por quê                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `ls src && bun test` | as duas partes são `allow`                                                                        |
| `ls src && rm x`     | `rm x` não tem regra: a parte mais restritiva vence                                               |
| `ls > out.txt`       | `ls` é `allow` (o `source` continua `allow`), mas o `>` esconde o efeito: vira `require_approval` |

### 2b. Quando a resposta é `require_approval`: `authorize`

`check` **só decide**: para `require_approval`, devolve a decisão e para. Não abre nada, não pergunta a ninguém. Perguntar é de quem usa a política, e o motor tem o ponto para isso: `authorize(action, approve)`, que decide e, só se precisar, chama **a sua** função.

`agents/meus-testes/policy-exemplos/2b-authorize.ts`:

```ts
/**
 * Exemplo 2b do curso de policy: decidir e, só em `require_approval`,
 * perguntar (`authorize`). Responda com uma tecla: s ou n.
 */
import { TerminalInteraction } from '../../../src/interaction/index';
import {
  PolicyEngine,
  type AgentAction,
  type ApprovalRequest,
} from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

const terminal = new TerminalInteraction();

/** Quem pergunta: o terminal, com uma tecla. */
async function askInTerminal({
  action,
  decision,
}: ApprovalRequest): Promise<boolean> {
  terminal.write(`    ${decision.reason}`);
  terminal.write(`    Permitir ${describe(action)}? [s/n]`);
  return (await terminal.choose(['s', 'n'])) === 's';
}

function describe(action: AgentAction): string {
  return action.category === 'execution'
    ? action.command
    : JSON.stringify(action);
}

for (const command of [
  'git status',
  'git push origin main',
  'git push --force origin main',
  'rm -rf build',
]) {
  terminal.write(`  ${command}`);
  const allowed = await policy.authorize(
    { category: 'execution', command },
    askInTerminal,
  );
  terminal.write(`    → ${allowed ? 'pode' : 'não pode'}`);
}

terminal.close();
```

Respondendo `s` à pergunta (saída real):

```
  git status
    → pode
  git push origin main
    A ação corresponde a permissions.requireApproval.execution.
    Permitir git push origin main? [s/n]
s
    → pode
  git push --force origin main
    → não pode
  rm -rf build
    → não pode
```

| Decisão do `check`                  | O que `authorize` faz                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| `allow`                             | `true`, sem perguntar                                      |
| `require_approval`                  | chama `approve({ action, decision })` e devolve a resposta |
| `deny`, por regra ou pelo `default` | `false`, sem perguntar                                     |

Quem pergunta é você: o terminal, um site, uma regra automática. Num agente, quem faz esse papel é o gate de comandos, que vai além do `authorize` em dois pontos:

- o approver do gate responde **por quanto tempo** vale (`once`, `session`, `workspace`), e a aprovação fica guardada; `authorize` devolve só sim ou não, e pergunta de novo da próxima vez;
- um `deny` pelo `default` não termina ali: fica **pendente** na tela de aprovações, para uma pessoa liberar depois. No `authorize`, é só `false`.

### 3. Aprovações salvas valem como allow

O gate de comandos passa as aprovações salvas (`[s]` sessão, `[w]` workspace) como `approved`. Este exemplo compara cada linha sem e com elas. `agents/meus-testes/policy-exemplos/3-aprovacoes.ts`:

```ts
/**
 * Exemplo 3 do curso de policy: padrões aprovados durante a execução valem
 * como allow (`checkCommand` com `approved`), e o padrão que uma aprovação
 * ampla salvaria (`suggestPattern`).
 */
import { writeOut } from '../../../src/output/terminal';
import { PolicyEngine, suggestPattern } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['ls *'] }] },
  requireApproval: { execution: [{ commands: ['rm *'] }] },
  deny: { execution: [{ commands: ['rm -rf *'] }] },
});

// O que o gate passaria: aprovações dadas antes, com [s] ou [w].
const approved = ['rm *', 'touch *'];

for (const line of [
  'rm build.log',
  'touch novo.txt',
  'rm -rf dist',
  'ls src && touch a',
  'touch a > b',
]) {
  const before = policy.checkCommand(line);
  const after = policy.checkCommand(line, { approved });
  writeOut(
    `${line}: sem aprovação → ${before.policy} (${before.source}); com → ${after.policy} (${after.source})\n`,
  );
}

writeOut('\n');
for (const command of ['mkdir -p src/pages', 'cd a && rm b', 'cat > a']) {
  writeOut(
    `suggestPattern(${JSON.stringify(command)}) → ${suggestPattern(command)}\n`,
  );
}
```

Saída real:

```
rm build.log: sem aprovação → require_approval (requireApproval); com → allow (approved)
touch novo.txt: sem aprovação → deny (default); com → allow (approved)
rm -rf dist: sem aprovação → deny (deny); com → deny (deny)
ls src && touch a: sem aprovação → deny (default); com → allow (approved)
touch a > b: sem aprovação → deny (default); com → require_approval (approved)

suggestPattern("mkdir -p src/pages") → mkdir *
suggestPattern("cd a && rm b") → cd a && rm b
suggestPattern("cat > a") → cat > a
```

| Linha               | Com as aprovações    | Por quê                                                                                            |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `rm build.log`      | `allow` (`approved`) | o padrão aprovado vence `requireApproval`                                                          |
| `touch novo.txt`    | `allow` (`approved`) | e vence o `default`                                                                                |
| `rm -rf dist`       | `deny`               | o `deny` escrito vence qualquer aprovação                                                          |
| `ls src && touch a` | `allow` (`approved`) | cada parte passa: `ls` pela regra, `touch` pela aprovação                                          |
| `touch a > b`       | `require_approval`   | linha complexa: um padrão não a cobre, só uma aprovação **exata** dela (o gate confere essa antes) |

O padrão que uma aprovação ampla salva vem de `suggestPattern`: um comando simples vira `programa *`; mais de um comando, ou uma linha complexa, fica exato.

### 4. A política de arquivos vira montagens da sandbox

`agents/meus-testes/policy-exemplos/4-arquivos.ts` (rode na raiz do repositório: os caminhos mascarados precisam existir):

```ts
/**
 * Exemplo 4 do curso de policy: a política de arquivos vira montagens da
 * sandbox (`compileFilesystemAccess`). Rode na raiz do repositório: os
 * caminhos mascarados precisam existir (node_modules, .env, guides).
 */
import { currentDirectory } from '../../../src/execute/process';
import { writeOut } from '../../../src/output/terminal';
import {
  compileFilesystemAccess,
  type AgentPolicy,
} from '../../../src/policy/index';

const root = currentDirectory();

// Escreve em tudo, menos node_modules (escondido); .env nunca é lido.
const project: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/node_modules/**'] },
      },
    ],
  },
  deny: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/.env'] }],
  },
};

// Lê tudo, escreve só em guides/ (como o Instructor).
const guidesOnly: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      { operations: ['read'], paths: ['/workspace/**'] },
      { operations: ['write'], paths: ['/workspace/guides/**'] },
    ],
  },
};

for (const [name, policy] of [
  ['project', project],
  ['guidesOnly', guidesOnly],
] as const) {
  const access = compileFilesystemAccess(policy, root);
  writeOut(
    `${name}: ${JSON.stringify(access, null, 2).replaceAll(root, '<root>')}\n`,
  );
}
```

Saída real:

```
project: {
  "workspaceAccess": "readwrite",
  "writable": [],
  "masks": [
    {
      "path": "<root>/node_modules",
      "access": "hidden"
    },
    {
      "path": "<root>/.env",
      "access": "hidden"
    }
  ]
}
guidesOnly: {
  "workspaceAccess": "readonly",
  "writable": [
    "<root>/guides"
  ],
  "masks": []
}
```

- `project`: o workspace é gravável; `node_modules` (pelo `ignores` do `allow`) e `.env` (pelo `deny` de leitura) ficam **escondidos** (`hidden`).
- `guidesOnly`: o workspace fica **só leitura** e `guides/` é montada gravável por cima.

### 5. O que fica para o provider

`agents/meus-testes/policy-exemplos/5-provider.ts`:

```ts
/**
 * Exemplo 5 do curso de policy: as categorias que a sandbox não aplica e
 * ficam para o provider traduzir (`delegatedCategories`).
 */
import { writeOut } from '../../../src/output/terminal';
import {
  delegatedCategories,
  type AgentPolicy,
} from '../../../src/policy/index';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
    network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
    web: [{ operations: ['search'], domains: ['*'] }],
    execution: [{ commands: ['ls *'] }],
  },
  deny: {
    communication: [{ operations: ['send_email'], channels: ['*'] }],
  },
};

writeOut(`${JSON.stringify(delegatedCategories(policy))}\n`);
```

Saída real:

```
["web","execution","communication"]
```

- `filesystem` e `network` não aparecem: a sandbox e o módulo `network` aplicam.
- `web`: a sandbox não sabe o que é uma busca; o provider traduz para a permissão da CLI dele (no Claude, `WebSearch`/`WebFetch`) ou recusa a política com erro.
- `execution`: aparece porque precisa do hook do gate ligado na CLI.
- `communication`: aparece por causa do `deny`. Uma regra em **qualquer** grupo conta: negar também é algo que alguém precisa aplicar.

### 6. A mesma política num agente

A política da seção [AgentPolicy em uma página](#agentpolicy-em-uma-página) não muda para ser usada por um agente: ela vai em `permissions`. `agents/meus-testes/policy-exemplos/6-agente.ts` (precisa do Ollama com o modelo e de um `.env` na raiz):

```ts
/**
 * Exemplo 6 do curso de policy: a mesma política num agente. Precisa do
 * Ollama com o modelo e de um `.env` na raiz (a política o esconde, e só se
 * esconde o que existe). Rode na raiz do repositório.
 */
import { Agent, OllamaProvider, Workspace } from '../../../src/index';
import { currentDirectory } from '../../../src/execute/process';
import type { AgentPolicy } from '../../../src/policy/index';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/.env'] },
      },
    ],
    execution: [{ commands: ['bun *', 'git status', 'git diff *'] }],
    network: [
      {
        operations: ['connect'],
        hosts: ['registry.npmjs.org', '*.github.com'],
      },
    ],
    secrets: [{ operations: ['read'], secrets: ['NODE_ENV'] }],
  },
  requireApproval: {
    execution: [{ commands: ['git commit *', 'rm *'] }],
  },
  deny: {
    execution: [{ commands: ['sudo *', 'rm -rf *'] }],
    network: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
  },
};

const agent = new Agent({
  name: 'assistente',
  prompt: 'rode os testes e corrija o que falhar',
  provider: new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' }),
  workspace: new Workspace({ type: 'bubblewrap', root: currentDirectory() }),
  permissions: policy, // o mesmo objeto que um PolicyEngine leria
  conversation: false,
});

await agent.run();
```

O agente não decide nada sozinho: ele entrega cada parte da política a quem sabe aplicá-la, ao ser criado.

| Parte da política      | O que o agente faz                                                  | Quem aplica                                                                                                  |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tools`, `agents`      | recusa a política inteira, com erro                                 | ninguém, ainda                                                                                               |
| `filesystem`           | `workspace.applyPermissions(policy, …)` → `compileFilesystemAccess` | a sandbox: workspace gravável, `.env` escondido (ele precisa existir ao iniciar: só se esconde o que existe) |
| `network`              | o workspace tira `networkRulesOf(policy)` e monta a fronteira       | o gate de rede                                                                                               |
| `execution`            | cria o gate de comandos e liga o hook na CLI                        | o gate, com `checkCommand` a cada linha                                                                      |
| `secrets`              | `check` em cada variável do ambiente                                | a sandbox nasce com o básico (`PATH`, `HOME`…) e, das outras variáveis, só `NODE_ENV`                        |
| `web`, `communication` | `delegatedCategories` → o provider traduz                           | a CLI do provider                                                                                            |

Durante a execução, as perguntas são as mesmas da tabela daquela seção, feitas por outros: quando a CLI tenta `rm build.log`, o gate pergunta ao `PolicyEngine`, recebe `require_approval` e chama quem aprova. A política, o motor e a resposta são os mesmos de um script; o agente só os ligou às peças que fazem valer.

### 7. Tools

O Goiaba não tem um registro de ferramentas: uma ferramenta é **uma função sua**, e a política só responde se ela pode rodar. Quem liga o nome à função e pergunta à política antes de rodar é o seu código. O arquivo completo, que roda como está, é `agents/meus-testes/tools.ts`.

Cada chamada passa por **duas perguntas**: `tools` (esta ferramenta pode ser chamada?) e a categoria do que ela toca (`communication` para o destinatário de um email, `filesystem` para o arquivo lido).

Exemplos abaixo:

- [A política](#a-política-das-ferramentas)
- [O formato de uma ferramenta](#o-formato-de-uma-ferramenta)
- [Ferramenta: ler email (`email/read`)](#ferramenta-ler-email-emailread)
- [Ferramenta: enviar email (`email/send`)](#ferramenta-enviar-email-emailsend)
- [Ferramenta: ler arquivo (`files/read`)](#ferramenta-ler-arquivo-filesread)
- [O registro e a chamada](#o-registro-e-a-chamada)
- [Rodando](#rodando)

#### A política das ferramentas

```ts
const policy = new PolicyEngine({
  default: 'deny',
  allow: {
    // Ler email e ler arquivo: sem perguntar.
    tools: [{ operations: ['call'], tools: ['email/read', 'files/read'] }],
    // Email só para a própria empresa.
    communication: [
      { operations: ['send_email'], channels: ['*@empresa.exemplo'] },
    ],
    // Arquivos: o README e a documentação.
    filesystem: [{ operations: ['read'], paths: ['README.md', 'docs/**'] }],
  },
  requireApproval: {
    // Enviar email: pergunta antes, sempre.
    tools: [{ operations: ['call'], tools: ['email/send'] }],
  },
  deny: {
    // Segredos: nunca, nem com aprovação.
    filesystem: [{ operations: ['*'], paths: ['.env', '**/*.key'] }],
  },
});
```

#### O formato de uma ferramenta

Uma ferramenta recebe argumentos com nome e devolve um texto, que é o que o modelo, ou quem chamou, lê de volta:

```ts
type Args = Readonly<Record<string, string>>;
type Tool = (args: Args) => Promise<string>;
```

Cada uma confere, antes de agir, **o recurso que vai tocar**. A ferramenta em si já foi liberada por `tools` (veja [O registro e a chamada](#o-registro-e-a-chamada)).

#### Ferramenta: ler email (`email/read`)

Não toca em nenhum recurso que a política descreva além da própria ferramenta: `tools` liberou, ela lê.

```ts
/** Lê a caixa de entrada (aqui, uma de mentira). */
const readEmail: Tool = () =>
  Promise.resolve(
    '1. de chefe@empresa.exemplo: reunião às 10h\n2. de cliente@fora.exemplo: proposta',
  );
```

#### Ferramenta: enviar email (`email/send`)

O destinatário é um **canal** de `communication`: a ferramenta pergunta à política por ele, com a operação `send_email`.

```ts
/** Envia um email, se o destinatário for permitido (aqui, só simula). */
const sendEmail: Tool = async ({ to = '', subject = '' }) => {
  const allowed = await policy.authorize(
    { category: 'communication', operation: 'send_email', channel: to },
    ask,
  );
  if (!allowed) return `Destinatário não permitido: ${to}.`;
  return `Enviado para ${to}: "${subject}" (simulado).`;
};
```

#### Ferramenta: ler arquivo (`files/read`)

O arquivo é um **caminho** de `filesystem`: a ferramenta pergunta à política pela leitura dele antes de abrir.

```ts
/** Lê um arquivo do projeto, se o caminho for permitido. */
const readFile: Tool = async ({ path = '' }) => {
  const allowed = await policy.authorize(
    { category: 'filesystem', operation: 'read', path },
    ask,
  );
  if (!allowed) return `Leitura não permitida: ${path}.`;
  const [firstLine = ''] = readText(join(currentDirectory(), path)).split('\n');
  return `${path}: ${firstLine}`;
};
```

#### O registro e a chamada

O nome que a política conhece aponta para a função, e `callTool` pergunta à política antes de qualquer coisa:

```ts
const tools = new Map<string, Tool>([
  ['email/read', readEmail],
  ['email/send', sendEmail],
  ['files/read', readFile],
]);

async function callTool(name: string, args: Args = {}): Promise<string> {
  const tool = tools.get(name);
  const allowed = await policy.authorize(
    { category: 'tools', operation: 'call', tool: name },
    ask,
  );
  if (!allowed) return `Ferramenta não permitida: ${name}.`;
  if (tool === undefined) return `Ferramenta desconhecida: ${name}.`;
  return tool(args);
}
```

`ask` é o mesmo `ApprovalHandler` do Exemplo 2b: mostra o motivo e espera `s` ou `n`.

#### Rodando

`bun agents/meus-testes/tools.ts`, respondendo `s` às duas perguntas (saída real):

```
email/read {}
  1. de chefe@empresa.exemplo: reunião às 10h
  2. de cliente@fora.exemplo: proposta

files/read {"path":"docs/agents.md"}
  docs/agents.md: # Agentes

files/read {"path":".env"}
  Leitura não permitida: .env.

email/send {"to":"colega@empresa.exemplo","subject":"Ata da reunião"}
    A ação corresponde a permissions.requireApproval.tools.
    Permitir a ferramenta email/send? [s/n]
s
  Enviado para colega@empresa.exemplo: "Ata da reunião" (simulado).

email/send {"to":"cliente@fora.exemplo","subject":"Proposta"}
    A ação corresponde a permissions.requireApproval.tools.
    Permitir a ferramenta email/send? [s/n]
s
  Destinatário não permitido: cliente@fora.exemplo.

slack/send {"text":"oi"}
  Ferramenta não permitida: slack/send.
```

| Chamada                     | `tools`                  | Recurso                           | Resultado                                                 |
| --------------------------- | ------------------------ | --------------------------------- | --------------------------------------------------------- |
| `email/read`                | `allow`                  | —                                 | lê                                                        |
| `files/read docs/agents.md` | `allow`                  | `filesystem`: `allow` (`docs/**`) | lê                                                        |
| `files/read .env`           | `allow`                  | `filesystem`: `deny`              | não lê: a ferramenta pode, o arquivo não                  |
| `email/send` para a empresa | `require_approval` → `s` | `communication`: `allow`          | envia                                                     |
| `email/send` para fora      | `require_approval` → `s` | `communication`: `default`        | não envia: aprovar a ferramenta não aprova o destinatário |
| `slack/send`                | `default`                | —                                 | não roda: nem está registrada, mas a política barra antes |

Duas coisas para notar:

- **Aprovar a ferramenta não libera tudo o que ela faz.** Você disse `s` para `email/send` nas duas vezes; quem barrou o email para fora foi a regra de `communication`.
- **A política vem antes do registro.** `slack/send` não existe no `Map`, mas a resposta é "não permitida", não "desconhecida": a pergunta à política é a primeira coisa que `callTool` faz.

> Num agente, as regras de `tools` fazem a política ser recusada (a categoria ainda não é aplicada às ferramentas da CLI). Este padrão é para ferramentas **suas**, chamadas pelo seu código, como as do `agents/meus-testes/ollama.chat.ts`.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- Definir **a forma** de uma política. Há um modelo só, para todos os providers; cada provider traduz a partir dele.
- Decidir **quem vence** entre as regras: `deny` > `requireApproval` > `allow` > `default`, igual para toda categoria.
- Validar a política ao criar o motor: `default` válido, regra com alvos e operações, padrões que compilam.

**Ninguém deve:**

- **Reimplementar a precedência** fora daqui. Quem precisa decidir, pergunta ao `PolicyEngine` (a rede tem a dela em `network/rules.ts`, com a mesma ordem).
- **Usar `requireApproval` em arquivos.** É recusado: não há interceptor seguro.
- **Escrever um padrão de comando com `?`, `[` ou `\`.** É recusado; só texto e `*`.
- **Esperar que uma aprovação vença um `deny`.** O `deny` escrito é o "nunca" da política.
- **Escrever regras de `tools` ou `agents`.** Ainda não são aplicadas: o agente recusa a política em vez de fingir que vale.

[↑ topo](#topo)

## Exercícios

1. **Simples.** Com a política do Exemplo 1, qual a decisão para `git log`, `git push --force-with-lease origin main` e `bun install`? Diga a regra que decidiu cada uma.

2. **Intermediário.** Com a mesma política, explique a decisão de `bun test | tee log.txt` e de `bun test 2>/dev/null`. Por que uma e outra não são `allow`, mesmo com `bun *` liberado?

3. **Difícil.** Uma política tem `allow.filesystem: [{ operations: ['read', 'write'], paths: ['/workspace/**'] }]` e `deny.filesystem: [{ operations: ['write'], paths: ['/workspace/package.json'] }]`. Seguindo `compileFilesystemAccess`, diga o que a sandbox monta para `package.json`. Depois explique por que trocar o `deny` por `requireApproval` faz a política ser recusada.

[↑ topo](#topo)
