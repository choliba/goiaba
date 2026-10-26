# Goiaba

Roda agentes de código (Claude Code, Codex, Cursor) a partir de scripts
TypeScript, opcionalmente dentro de uma sandbox com permissões de filesystem.

O fluxo é dividido em quatro responsabilidades:

- `Executor` coordena o provider com o workspace e é o único responsável por
  executar processos;
- providers descrevem cada programa e interpretam suas respostas;
- `OutputStream<T>` e `OutputDispatcher<T>` são o único caminho das saídas
  brutas e interpretadas;
- `StandardOutput` adapta stdin/stdout na borda da aplicação.

Os agentes ficam em `agents/` e rodam pelos scripts do `package.json`:

```bash
bun run arquiteto
bun run seguro
```

O agente usa a saída padrão automaticamente: depois de instanciado, basta
chamar `run()`. Envolva o script em `runScript`, que carrega o
`goiaba.config.ts` e mostra erros de uso (`UsageError`) sem stack trace.

```ts
import { Agent, ClaudeProvider, runScript, Workspace } from '../src/index';

await runScript(async () => {
  const agent = new Agent({
    prompt: 'Analise o projeto.',
    provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: process.cwd(),
    }),
  });

  await agent.run();
});
```

Para observar os eventos interpretados de cada execução, passe um
`OutputDispatcher<ProviderEvent<string>>` em `output` (ou um `Executor` próprio
em `executor`; nunca os dois). `interact` permanece disponível para quem
precisa consumir os eventos direto.

```ts
import {
  Agent,
  ClaudeProvider,
  OutputDispatcher,
  runScript,
  Workspace,
  type ProviderEvent,
} from '../src/index';

await runScript(async () => {
  const output = new OutputDispatcher<ProviderEvent<string>>();

  void (async () => {
    for await (const event of output.subscribe()) {
      console.log(event.executionId, event.programId, event.value);
    }
  })();

  const agent = new Agent({
    prompt: 'Analise o projeto.',
    provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: process.cwd(),
    }),
    output,
  });

  await agent.run();
});
```

## Parar o agente

Dentro de `runScript`, o primeiro **Ctrl+C** para o agente: o CLI recebe
`SIGTERM` (e `SIGKILL` depois de 2 s), uma pergunta pendente é cancelada, o
`Workspace` é fechado (jaula bubblewrap derrubada, container Docker removido)
e `run()` retorna em silêncio. Um segundo Ctrl+C força a saída. **Ctrl+D**
durante uma pergunta também encerra.

Para parar pelo código, passe um `AbortSignal` em `signal`; sem ele, o agente
usa o sinal do `runScript`, que também chega ao callback:

```ts
await runScript(async ({ signal }) => {
  const agent = new Agent({
    prompt: 'Analise o projeto.',
    provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    // Para em 10 minutos ou no Ctrl+C, o que vier primeiro.
    signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
  });

  await agent.run();
});
```

## Providers

Todo provider recebe **as mesmas opções**: o agente é configurado igual para
qualquer CLI, e o que muda é só qual provider você escolhe.

```ts
new ClaudeProvider({ model: 'claude-sonnet-5-5' });
new CodexProvider({ model: 'gpt-6.1-sol' });
new CursorProvider({ model: 'Auto' });
```

| Opção        | Tipo     | Obrigatória | Descrição                                            |
| ------------ | -------- | ----------- | ---------------------------------------------------- |
| `model`      | `string` | sim         | Modelo, no nome que o CLI entende.                   |
| `executable` | `string` | não         | Binário do CLI (padrão: `claude`, `codex`, `agent`). |

O que é específico de cada CLI o provider decide sozinho, a partir do que é
comum a todos: a sandbox (que sempre existe) e as `permissions`. Em modo não
interativo não há ninguém para aprovar ferramentas, então a sandbox é o
limite:

| Provider         | CLI      | Como roda                                                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ClaudeProvider` | `claude` | `--permission-mode bypassPermissions`; com `permissions.execution`, `dontAsk` + o hook do [gate de execução](#gate-de-execução) |
| `CodexProvider`  | `codex`  | `--sandbox danger-full-access --skip-git-repo-check` (o isolamento externo do `Workspace` é a fronteira de segurança)           |
| `CursorProvider` | `agent`  | `--trust --force`                                                                                                               |

Quando a resposta do agente termina em `?`, ela vira uma pergunta (`ask`) e a
resposta do usuário retoma a mesma sessão.

### Modelos locais com Ollama

O `OllamaProvider` roda o Claude Code ou o Codex contra um modelo do
[Ollama](https://ollama.com). Ele reaproveita o provider do CLI escolhido
(montagem do comando, leitura da saída e permissões) e só aponta o CLI para o
servidor do Ollama por variáveis de ambiente.

```ts
new OllamaProvider({
  cli: 'claude', // ou 'codex'
  model: 'qwen3.5:4b',
  baseUrl: 'http://127.0.0.1:11434', // opcional; este é o padrão
});
```

| `cli`    | Como aponta para o Ollama                                                                                                               | Permissões                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `claude` | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama` e os modelos auxiliares (`ANTHROPIC_DEFAULT_*_MODEL`) apontando para o mesmo modelo | `execution` via permissões do Claude Code  |
| `codex`  | `codex exec --oss --local-provider ollama` com `CODEX_OSS_BASE_URL`; desliga `apps` e `goals`; a sandbox pertence ao `Workspace`        | como no `CodexProvider` (gate de execução) |

- O modelo precisa estar baixado (`ollama pull <modelo>`) e suportar
  ferramentas (`ollama show <modelo>` lista `tools`). Para o Claude Code, use
  contexto de pelo menos 64k.
- No `codex`, os conectores do ChatGPT (`apps`) e `goals` ficam desligados:
  com eles, modelos locais pequenos não enxergam a ferramenta de shell.
- O Cursor CLI não tem suporte: ele envia as requisições de modelo pelo
  backend da Cursor, que não alcança um servidor local.

## Permissões

As permissões são definidas no próprio agente TypeScript (tipo
`AgentPolicy`, em `src/policy/policy.interface.ts`, o único modelo de
permissão do Goiaba), com o mesmo vocabulário para todos os providers. Quem
aplica depende da categoria:

- `filesystem` é aplicado pela sandbox do `Workspace` (`docker` ou
  `bubblewrap`), igual para qualquer provider;
- `web`, `execution` e `communication` são traduzidos por cada provider
  (`applyPermissions`) para o mecanismo do próprio CLI. O que o CLI não
  consegue aplicar com exatidão é recusado antes de iniciar;
- `network`, `tools`, `agents` e `secrets` fazem parte do modelo, mas o
  Goiaba ainda não os aplica: um agente com regras delas recusa iniciar.

Nenhuma política é reduzida silenciosamente para best effort.

### Exemplo com todas as opções

> Este exemplo mostra todos os campos que o tipo aceita. Hoje ele **é
> recusado**, porque nenhum provider aplica ainda `web` e `communication` (veja
> [O que já é aplicado](#o-que-já-é-aplicado)). Para um agente que roda, use
> `filesystem` em `allow`/`deny` e `execution` em `allow`/`deny`/`requireApproval`
> com Claude, Codex ou Ollama.

```ts
const agent = new Agent({
  prompt: 'Analise o projeto.',
  provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
  workspace: new Workspace({
    type: 'bubblewrap',
    root: '/caminho/do/projeto/storage/workspace',
  }),
  permissions: {
    // Política quando nenhuma regra corresponde: 'allow' | 'deny' | 'require_approval'
    default: 'deny',

    allow: {
      filesystem: [
        {
          operations: ['read', 'write'], // ou ['*']
          paths: ['/workspace/**'],
          ignores: { paths: ['/workspace/.git/**'] },
        },
      ],
      web: [
        {
          operations: ['search', 'read_text', 'browse'],
          domains: ['docs.github.com', '*.mozilla.org'],
          ignores: { domains: ['ads.mozilla.org'] },
        },
      ],
      execution: [
        {
          commands: ['bun *', 'npm *'],
          ignores: { commands: ['npm publish*'] },
        },
      ],
      communication: [
        {
          operations: ['send_logs'],
          channels: ['slack:#builds'],
          ignores: { channels: ['slack:#geral'] },
        },
      ],
    },

    requireApproval: {
      filesystem: [
        { operations: ['write'], paths: ['/workspace/package.json'] },
      ],
      web: [{ operations: ['interact', 'form_submit'], domains: ['*'] }],
      execution: [{ commands: ['*'] }],
      communication: [{ operations: ['send_email'], channels: ['email:*'] }],
    },

    deny: {
      filesystem: [{ operations: ['*'], paths: ['/workspace/.env'] }],
      web: [{ operations: ['login'], domains: ['*'] }],
      execution: [{ commands: ['rm -rf *', 'sudo *'] }],
      communication: [{ operations: ['post_social_media'], channels: ['*'] }],
    },
  },
});
```

### Campos

**`AgentPolicy`**

| Campo             | Tipo           | Obrigatório | Descrição                                        |
| ----------------- | -------------- | ----------- | ------------------------------------------------ |
| `default`         | `ActionPolicy` | sim         | Política usada quando nenhuma regra corresponde. |
| `allow`           | `PolicyGroups` | não         | Regras que liberam a ação.                       |
| `requireApproval` | `PolicyGroups` | não         | Regras que exigem aprovação antes da ação.       |
| `deny`            | `PolicyGroups` | não         | Regras que bloqueiam a ação.                     |

**`ActionPolicy`**: `'allow' | 'deny' | 'require_approval'`

**`PolicyGroups`**

| Campo           | Tipo                  | Obrigatório |
| --------------- | --------------------- | ----------- |
| `filesystem`    | `FilesystemRule[]`    | não         |
| `web`           | `WebRule[]`           | não         |
| `network`       | `NetworkRule[]`       | não         |
| `execution`     | `ExecutionRule[]`     | não         |
| `tools`         | `ToolRule[]`          | não         |
| `agents`        | `SubagentRule[]`      | não         |
| `communication` | `CommunicationRule[]` | não         |
| `secrets`       | `SecretRule[]`        | não         |

**Regras**

Em todas as categorias menos `execution`, `operations` não pode ser vazio, e
`'*'` vale para todas as operações da categoria. `execution` não tem
`operations`: nenhum CLI consegue verificar a intenção de um comando (teste,
lint...), só o comando em si, então a regra é só `commands`, que não pode ser
vazio.

| Regra               | Campo              | Tipo                                | Obrigatório |
| ------------------- | ------------------ | ----------------------------------- | ----------- |
| `FilesystemRule`    | `operations`       | `(FilesystemOperation \| '*')[]`    | sim         |
|                     | `paths`            | `string[]`                          | sim         |
|                     | `ignores.paths`    | `string[]`                          | não         |
| `WebRule`           | `operations`       | `(WebOperation \| '*')[]`           | sim         |
|                     | `domains`          | `string[]`                          | sim         |
|                     | `ignores.domains`  | `string[]`                          | não         |
| `ExecutionRule`     | `commands`         | `string[]`                          | sim         |
|                     | `ignores.commands` | `string[]`                          | não         |
| `CommunicationRule` | `operations`       | `(CommunicationOperation \| '*')[]` | sim         |
|                     | `channels`         | `string[]`                          | sim         |
|                     | `ignores.channels` | `string[]`                          | não         |
| `NetworkRule`       | `operations`       | `(NetworkOperation \| '*')[]`       | sim         |
|                     | `hosts`            | `string[]`                          | sim         |
|                     | `ignores.hosts`    | `string[]`                          | não         |
| `ToolRule`          | `operations`       | `(ToolOperation \| '*')[]`          | sim         |
|                     | `tools`            | `string[]` (`servidor/ferramenta`)  | sim         |
|                     | `ignores.tools`    | `string[]`                          | não         |
| `SubagentRule`      | `operations`       | `(SubagentOperation \| '*')[]`      | sim         |
|                     | `agents`           | `string[]` (nome ou modelo)         | sim         |
|                     | `ignores.agents`   | `string[]`                          | não         |
| `SecretRule`        | `operations`       | `(SecretOperation \| '*')[]`        | sim         |
|                     | `secrets`          | `string[]` (nome da variável)       | sim         |
|                     | `ignores.secrets`  | `string[]`                          | não         |

**Operações**

| Tipo                     | Valores                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `FilesystemOperation`    | `'read'`, `'write'`                                                             |
| `WebOperation`           | `'search'`, `'read_text'`, `'interact'`, `'form_submit'`, `'login'`, `'browse'` |
| `CommunicationOperation` | `'send_email'`, `'post_social_media'`, `'send_logs'`                            |
| `NetworkOperation`       | `'connect'`                                                                     |
| `ToolOperation`          | `'call'`                                                                        |
| `SubagentOperation`      | `'spawn'`                                                                       |
| `SecretOperation`        | `'read'`                                                                        |

### Como as regras são avaliadas

`ignores` retira somente a regra em que aparece; ele nunca concede acesso.
Entre regras aplicáveis, a precedência é `deny`, `requireApproval`, `allow` e,
por fim, `default`.

Todos os seletores usam exclusivamente padrões
[Git wildmatch](https://git-scm.com/docs/gitignore#_pattern_format), com matching
case-sensitive: `*` não atravessa `/`, `**` atravessa diretórios, `?` representa
um caractere, `[]` define classes e `\` escapa caracteres especiais. Não há
fallback para regex ou POSIX `fnmatch`. A exceção são os `commands` de
`execution`: neles `*` e `**` significam "qualquer sequência", como nos CLIs
(`bun *` casa `bun run ./a/b`). Para filesystem, `/workspace` representa
a raiz real do `Workspace`; o caminho real do `root` também é aceito
(`` `${root}/**` `` equivale a `/workspace/**`).

### O que já é aplicado

| Categoria       | Quem aplica                              | `allow`  | `deny`              | `requireApproval` |
| --------------- | ---------------------------------------- | -------- | ------------------- | ----------------- |
| `filesystem`    | sandbox (`docker`, `bubblewrap`)         | sim      | sim (sem `ignores`) | recusado          |
| `execution`     | gate de execução (Claude, Codex, Ollama) | sim      | sim                 | sim (pergunta)    |
| `execution`     | `CursorProvider`                         | recusado | recusado            | recusado          |
| `web`           | `ClaudeProvider`                         | sim¹     | sim¹                | recusado          |
| `web`           | `CodexProvider`                          | sim²     | sim²                | recusado          |
| `communication` | nenhum provider ainda                    | recusado | recusado            | recusado          |

Uma categoria sem nenhuma regra não é controlada: sem `execution`, o agente
roda qualquer comando, preso só à sandbox.

¹ O Claude traduz apenas as operações e os domínios representáveis por suas
ferramentas. ² O Codex traduz uma regra `allow.web` com `operations: ['*']`
para `tools.web_search`, incluindo domínios permitidos e domínios bloqueados
por `ignores` ou `deny`; `requireApproval.web` ainda é recusado.

**Filesystem.** O backend também exige:

- `default: 'deny'`;
- um `allow` de `read` com exatamente `/workspace/**` (com `write` junto, o
  workspace fica leitura/escrita; sem ele, só leitura);
- em `ignores` e `deny`, caminhos exatos ou árvores terminadas em `/**`, sem
  outros curingas, que existam no disco e não sejam symlinks para fora do
  workspace.

### Gate de execução

`execution` é decidido **pelo Goiaba, igual para qualquer CLI**. O provider só
liga o hook `PreToolUse` do CLI (Claude Code ou Codex) a um gate; o hook, dentro
da sandbox, pergunta ao gate, que roda no host, por um socket:

```
CLI (na jaula) ── hook PreToolUse (só leitura) ── socket ──► gate (host)
                                                               ├─ PolicyEngine
                                                               ├─ aprovações salvas (SQLite)
                                                               └─ você (OutputAdapter)
```

- **Um comando por vez.** A linha é dividida em `&&`, `||`, `;` e `|`, e cada
  parte é avaliada; vence a decisão mais restritiva (`deny` > aprovação >
  `allow`). Linha com redirecionamento, substituição ou script (`>`, `<`,
  `$(...)`, `` ` ``, heredoc, `&`) vai para aprovação mesmo se o comando
  inicial for permitido: o efeito não é verificável pela regra.
- **Aprovação.** O que cai em `requireApproval` (ou no `default` que não seja
  `allow`/`deny`) é perguntado pelo terminal:
  `[u] uma vez · [s] nesta sessão · [w] sempre neste workspace · [n] não`.
  Sessão e workspace salvam um padrão (`mkdir -p src/x` → `mkdir *`); um
  comando composto só é aprovado exatamente como veio. Sem terminal, nega. A
  opção `approve` do `Agent` troca quem decide.
- **Falha fechada.** Hook sem resposta, gate fora do ar ou timeout negam o
  comando. O hook e a configuração do CLI ficam montados **só leitura** na
  sandbox (`Sandbox.protect`): o agente não reescreve o que aplica a política.
- **No Claude**, o hook vai por `--settings` (com `--setting-sources ""`) e o
  modo é `dontAsk`: só roda o que o hook aprova; as ferramentas de arquivo
  (`Read`, `Edit`, `Write`...) ficam liberadas porque quem limita os caminhos
  é a sandbox. **No Codex**, o hook fica em um `CODEX_HOME` do workspace
  (`~/.cache/goiaba/codex/<hash>`), estável para a sessão poder ser retomada.

### Decisões, aprovações depois e retomada

Toda decisão do gate fica no banco SQLite (por padrão `.goiaba/goiaba.db`; veja `database` em [Configuração](#configuração)), com a origem
(`policy`, `human`, `saved`). O que foi negado pode ser aprovado depois, e o
agente retoma sabendo disso. A tela de aprovações abre com **Ctrl+A** dentro
do agente, ou com `bun run approvals` (`--root <dir>`) em outro terminal:
marque os pedidos (números, `1,3`, `1-5`, `a` para todos), avance com `r` e
escolha:

- `u`: aprova uma vez (o comando exato);
- `w`: aprova sempre neste workspace (o padrão do comando, como `npm *`);
- `d`: **descarta**: o pedido não é aprovado e deixa de ser esperado (some da
  tela e do aviso "Aguardando aprovação"). Fica registrado no banco; se o
  agente tentar o comando de novo, vira um pedido novo;
- `q`: sai sem alterar nada.

O mesmo comando negado de novo enquanto o pedido está pendente não cria outra
linha: conta como mais uma tentativa (`×N` na tela).

```ts
new Agent({
  prompt: 'Continue.',
  provider,
  workspace,
  permissions,
  resume: 'last', // ou o id de uma sessão
});
```

Com `resume`, o primeiro turno retoma a sessão do CLI (`--resume`) e começa
com as aprovações novas: "Permissões atualizadas desde a última execução: …
Continue a tarefa de onde parou." `'last'` é a última sessão do mesmo provider
no mesmo workspace; sem sessão anterior, o agente para com um erro.

## Workspace

O `Workspace` define onde o CLI do agente roda e o que ele enxerga do host. O
agente sempre roda isolado: não há modo sem sandbox. O `type` escolhe o
isolamento; em todos, o `cwd` do CLI é o `root`.

| Tipo         | Isolamento            | Campos                       |
| ------------ | --------------------- | ---------------------------- |
| `bubblewrap` | jaula `bwrap` no host | `root`, `writable?`          |
| `docker`     | container como jaula  | `root`, `image`, `writable?` |

Nos dois, o CLI continua sendo o do host, e ficam graváveis só o
`root`, o estado dos CLIs (`~/.config`, `~/.cache`, `~/.local/share`,
`~/.cursor`, `~/.codex`, `~/.claude`, `~/.claude.json`) e os caminhos extras em
`writable`. Caminhos de `writable` que não existem são ignorados.

### `bubblewrap`

Envolve o binário do host com `bwrap`. Só entram o sistema (`/usr`, `/etc`,
bins no `PATH`), o `root` e os caminhos graváveis acima; o resto do host não é
montado, então `cd ..` a partir do `root` não lista o repositório pai. A rede é
compartilhada com o host.

- Precisa de Linux com user namespaces, `bwrap` e `nsenter`.
- O `root` precisa existir antes do primeiro comando.
- A jaula fica de pé enquanto o `Workspace` existir (inclusive durante um
  `ask`).
- Com `debug: true`, o log traz `childPid` e o comando `nsenter` para entrar
  na jaula.

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

new Workspace({
  type: 'bubblewrap',
  root: '/caminho/do/projeto/storage/workspace',
  // Ex.: caches para bun/npm install funcionarem dentro da jaula.
  writable: [join(homedir(), '.bun/install/cache'), join(homedir(), '.npm')],
});
```

### `docker`

Envolve o comando em `docker run`, usando a imagem só como jaula: o CLI do
host roda via `chroot` num filesystem do host montado como somente leitura. A
rede usa o modo `host`.

- `image` é obrigatório e deve ter a forma `FROM <imagem>` (ex.:
  `FROM oven/bun:latest`, exportado como `DEFAULT_DOCKER_IMAGE`); o Docker
  baixa qualquer referência.
- Precisa do Docker instalado e acessível pelo usuário.

```ts
new Workspace({
  type: 'docker',
  root: '/caminho/do/projeto/storage/workspace',
  image: 'FROM oven/bun:latest',
});
```

## Desenvolvimento

```bash
bun run check   # typecheck + lint + formatação + testes
bun run lint    # oxlint com regras que usam tipos
bun run format  # prettier --write
```

- **Tipos:** o `tsconfig.json` estende o `@tsconfig/strictest`
  (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, etc.).
- **Lint:** [Oxlint](https://oxc.rs) com `oxlint-tsgolint`, que roda as regras
  do typescript-eslint que dependem de tipos direto sobre o TypeScript 7 (o
  typescript-eslint ainda não suporta o TS 7). Configuração em `.oxlintrc.json`.
  Duas exceções deliberadas:
  - `no-await-in-loop` desligada: turnos do agente e esperas são sequenciais
    por natureza;
  - nos testes, `await-thenable` e `no-unsafe-argument`/`-assignment`
    desligadas: os tipos do `bun:test` declaram `.rejects` como não-Promise e
    os matchers (`expect.objectContaining`...) como `any`.
- **Formatação:** Prettier com os padrões da v3 e aspas simples.
- **Fronteiras:** executar é pelo `execute` (`src/execute/`: processos,
  ambiente, `/proc`), sair é pelo `output` (`src/output/`) e disco é pelo
  `filesystem` (`src/filesystem/`). O resto do código não usa `process`,
  `child_process`, `node:fs` nem `node:path` diretamente (caminhos também
  vêm do `filesystem`). O log é pelo `logger`
  (`src/logger/`) e os comandos de linha de comando pelo `command`
  (`src/command/`); pacotes de terceiros ficam atrás deles.

### Comandos

Scripts de linha de comando (`scripts/`, `src/cli/`) só declaram o comando; o
`src/command` lê os argumentos, valida, gera o `--help` e roda dentro do
`runScript` (config, log e Ctrl+C). `--help` e erros de uso respondem na hora,
sem abrir o log, e erros de uso terminam com código 1.

```ts
import { defineCommand, runCommand } from '../src/command/index';

await runCommand(
  defineCommand({
    name: 'issue',
    description: 'Abre uma issue no GitHub a partir de um Markdown.',
    args: { arquivo: { description: 'Markdown do plano', required: true } },
    options: {
      repo: { type: 'string', short: 'r', description: 'owner/nome' },
      dry: { type: 'boolean', short: 'd', description: 'Só mostra' },
    },
    // args.arquivo: string; options.repo: string | undefined; options.dry: boolean
    run: async ({ args, options, output, signal }) => {
      /* … */
    },
  }),
);
```

| Comando               | O que faz                                                      |
| --------------------- | -------------------------------------------------------------- |
| `bun issue <arquivo>` | Abre uma issue a partir de um plano com frontmatter (`--dry`). |
| `bun clear`           | Apaga o conteúdo de `logger.dir` (`--dry`, `--yes`).           |
| `bun run approvals`   | Revisa e aprova comandos negados (`--root <dir>`).             |

## Configuração

A configuração do projeto fica em `goiaba.config.ts` na raiz. O env é um objeto
qualquer: as chaves string viram variáveis de ambiente (sem sobrescrever o
`process.env` já definido). `logger.dir` recebe o log da sessão. Com `debug: true`, cada sandbox
grava isolamento, imagem/container, volumes, montagens e rede; o executor
grava os comandos (inner, spawn, exit) e as tool calls do agente.
`GOIABA_DEBUG` e `GOIABA_LOG_DIR` (para `logger.dir`) também sobrescrevem o arquivo.

```ts
import { defineConfig } from './src/config/index';

export default defineConfig({
  debug: false,
  logger: { dir: 'logs' }, // sem `use`: ECS JSONL, sem pacote
  // Banco SQLite de sessões, decisões e aprovações (opcional).
  database: {
    dir: 'db', // relativo a este arquivo; padrão: .goiaba
    name: 'agentes.db', // padrão: goiaba.db
  },
  envs: [
    {
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    },
  ],
});
```

| Campo           | Tipo       | Padrão         | Descrição                                                    |
| --------------- | ---------- | -------------- | ------------------------------------------------------------ |
| `debug`         | `boolean`  | `false`        | Grava sandbox, comandos e tool calls no log.                 |
| `logger.dir`    | `string`   | `.goiaba/logs` | Pasta do log; relativa ao arquivo de config.                 |
| `logger.use`    | `função`   | —              | Cria a instância do pacote de log (veja [Log](#log)).        |
| `database.dir`  | `string`   | `.goiaba`      | Pasta do banco SQLite; relativa ao arquivo de config.        |
| `database.name` | `string`   | `goiaba.db`    | Nome do arquivo do banco (sem barras).                       |
| `envs`          | `object[]` | `[]`           | Variáveis de ambiente; as chaves string vão para o ambiente. |

### Log

Todo registro segue o mesmo contrato, qualquer que seja o pacote: estrutura
[ECS](https://www.elastic.co/guide/en/ecs/current/index.html) (`@timestamp`,
`log.level`, `service`, `trace.id`, `transaction.id`, `message`, `user`) e
nomes semânticos do [OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/)
para o que cada evento traz (`event.name`, `gen_ai.*`, `process.*`, `error.*`).
O que é só do Goiaba fica em `goiaba.*`; o texto da conversa, em
`goiaba.content`. `trace.id` identifica a execução do script e
`transaction.id`, cada `Agent.run()`.

Todo registro de um agente diz em que ele roda: `gen_ai.agent.name`,
`gen_ai.provider.name` (`ollama`, `claude`…), `gen_ai.request.model` e, quando
o provider dirige uma CLI (Ollama com `claude` ou `codex`), `goiaba.cli`. Com
`debug: true`, cada execução começa com um registro `agent_config`
(`goiaba.config`): nome, prompt, provider, workspace, permissões, gate,
conversa e a configuração do Goiaba (pasta do log, banco, envs) — segredos
mascarados.

Erros não vão para um arquivo à parte: são os registros com
`log.level: "error"`.

Segredos são mascarados antes de chegar ao pacote (`[REDACTED]`): chaves como
`token`, `secret`, `password`, `authorization`, argumentos `NOME_TOKEN=valor`
e os valores das envs sensíveis do config.

Sem `logger.use`, o Goiaba grava ECS JSONL em `logger.dir` (arquivos `0600`),
sem nenhum pacote. Com `logger.use`, você escolhe o
pacote: o Goiaba chama a função com `dir` (o `logger.dir` absoluto) e `session`
(o nome desta execução) e usa a instância devolvida — pino, winston, LogTape ou
qualquer objeto com `debug/info/warn/error`. Formato, nível e destino são da
instância; trocar de pacote muda só essa função.

```ts
import { join } from 'node:path';
import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';

export default defineConfig({
  logger: {
    dir: 'logs',
    use: ({ dir, session }) =>
      pino(
        { ...ecsFormat({ serviceName: 'goiaba' }), level: 'debug' },
        pino.destination({
          dest: join(dir, `${session}.jsonl`),
          sync: true,
          mkdir: true,
        }),
      ),
  },
});
```
