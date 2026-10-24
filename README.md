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
import { Agent, ClaudeProvider, runScript, Workspace } from '../src/index.js';

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
} from '../src/index.js';

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

| Provider | CLI | Opções |
| --- | --- | --- |
| `ClaudeProvider` | `claude` | `model`, `permissionMode?` (`'acceptEdits' \| 'auto' \| 'bypassPermissions' \| 'manual' \| 'dontAsk' \| 'plan'`), `executable?` |
| `CodexProvider` | `codex` | `model`, `skipGitRepositoryCheck?`, `executable?` |
| `CursorProvider` | `agent` | `model`, `force?`, `trust?` (padrão `true`), `executable?` |

Todos rodam o CLI do host em modo não interativo. Quando a resposta do agente
termina em `?`, ela vira uma pergunta (`ask`) e a resposta do usuário retoma a
mesma sessão. No `ClaudeProvider`, sem `permissionMode` não há ninguém para
aprovar as ferramentas; dentro de uma sandbox, `bypassPermissions` deixa a
sandbox como limite.

## Permissões

As permissões são definidas no próprio agente TypeScript (tipo
`AgentPermissions`, em `src/policy/types.ts`), com o mesmo vocabulário para
todos os providers. Quem aplica depende da categoria:

- `filesystem` é aplicado pela sandbox do `Workspace` (`docker` ou
  `bubblewrap`), igual para qualquer provider;
- `web`, `execution` e `communication` são traduzidos por cada provider
  (`applyPermissions`) para o mecanismo do próprio CLI. O que o CLI não
  consegue aplicar com exatidão é recusado antes de iniciar.

Nenhuma política é reduzida silenciosamente para best effort.

### Exemplo com todas as opções

> Este exemplo mostra todos os campos que o tipo aceita. Hoje ele **é
> recusado**, porque nenhum provider aplica ainda tudo o que ele pede (veja
> [O que já é aplicado](#o-que-já-é-aplicado)). Para um agente que roda, use
> `filesystem` em `allow`/`deny` e, com o `ClaudeProvider`, `execution` em
> `allow`/`deny`.

```ts
const agent = new Agent({
  prompt: 'Analise o projeto.',
  provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
  workspace: new Workspace({
    type: 'bubblewrap',
    root: '/home/dev/dev/goiaba/app',
  }),
  permissions: {
    // Política quando nenhuma regra corresponde: 'allow' | 'deny' | 'require_approval'
    default: 'deny',

    allow: {
      filesystem: [{
        operations: ['read', 'write'], // ou ['*']
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/.git/**'] },
      }],
      web: [{
        operations: ['search', 'read_text', 'browse'],
        domains: ['docs.github.com', '*.mozilla.org'],
        ignores: { domains: ['ads.mozilla.org'] },
      }],
      execution: [{
        commands: ['bun *', 'npm *'],
        ignores: { commands: ['npm publish*'] },
      }],
      communication: [{
        operations: ['send_logs'],
        channels: ['slack:#builds'],
        ignores: { channels: ['slack:#geral'] },
      }],
    },

    requireApproval: {
      filesystem: [{ operations: ['write'], paths: ['/workspace/package.json'] }],
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

**`AgentPermissions`**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `default` | `ActionPolicy` | sim | Política usada quando nenhuma regra corresponde. |
| `allow` | `PermissionGroups` | não | Regras que liberam a ação. |
| `requireApproval` | `PermissionGroups` | não | Regras que exigem aprovação antes da ação. |
| `deny` | `PermissionGroups` | não | Regras que bloqueiam a ação. |

**`ActionPolicy`**: `'allow' | 'deny' | 'require_approval'`

**`PermissionGroups`**

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `filesystem` | `FilesystemRule[]` | não |
| `web` | `WebRule[]` | não |
| `execution` | `ExecutionRule[]` | não |
| `communication` | `CommunicationRule[]` | não |

**Regras**

Em `filesystem`, `web` e `communication`, `operations` não pode ser vazio, e
`'*'` vale para todas as operações da categoria. `execution` não tem
`operations`: nenhum CLI consegue verificar a intenção de um comando (teste,
lint...), só o comando em si, então a regra é só `commands`, que não pode ser
vazio.

| Regra | Campo | Tipo | Obrigatório |
| --- | --- | --- | --- |
| `FilesystemRule` | `operations` | `(FilesystemOperation \| '*')[]` | sim |
| | `paths` | `string[]` | sim |
| | `ignores.paths` | `string[]` | não |
| `WebRule` | `operations` | `(WebOperation \| '*')[]` | sim |
| | `domains` | `string[]` | sim |
| | `ignores.domains` | `string[]` | não |
| `ExecutionRule` | `commands` | `string[]` | sim |
| | `ignores.commands` | `string[]` | não |
| `CommunicationRule` | `operations` | `(CommunicationOperation \| '*')[]` | sim |
| | `channels` | `string[]` | sim |
| | `ignores.channels` | `string[]` | não |

**Operações**

| Tipo | Valores |
| --- | --- |
| `FilesystemOperation` | `'read'`, `'write'` |
| `WebOperation` | `'search'`, `'read_text'`, `'interact'`, `'form_submit'`, `'login'`, `'browse'` |
| `CommunicationOperation` | `'send_email'`, `'post_social_media'`, `'send_logs'` |

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

| Categoria | Quem aplica | `allow` | `deny` | `requireApproval` |
| --- | --- | --- | --- | --- |
| `filesystem` | sandbox (`docker`, `bubblewrap`) | sim | sim (sem `ignores`) | recusado |
| `execution` | `ClaudeProvider` | sim | sim (sem `ignores`) | recusado |
| `execution` | `CodexProvider`, `CursorProvider` | recusado | recusado | recusado |
| `web` | nenhum provider ainda | recusado | recusado | recusado |
| `communication` | nenhum provider ainda | recusado | recusado | recusado |

Uma categoria sem nenhuma regra não é controlada: sem `execution`, o agente
roda qualquer comando, preso só à sandbox.

**Filesystem.** O backend também exige:

- `default: 'deny'`;
- um `allow` de `read` com exatamente `/workspace/**` (com `write` junto, o
  workspace fica leitura/escrita; sem ele, só leitura);
- em `ignores` e `deny`, caminhos exatos ou árvores terminadas em `/**`, sem
  outros curingas, que existam no disco e não sejam symlinks para fora do
  workspace.

**Execution no `ClaudeProvider`.** As regras viram `--settings` com
`permissions.allow`/`deny` em `Bash(<comando>)`, com o modo `dontAsk` (nega o
que não estiver em `allow`) e `--setting-sources ""` (as configurações do
usuário e do projeto não podem liberar mais nada). Por isso:

- `default` precisa ser `'deny'`, e `permissionMode` precisa ficar ausente ou
  ser `'dontAsk'`;
- `ignores` de um `allow` vira `deny`: nunca libera mais que a política, mas
  pode bloquear um comando que outra regra `allow` liberaria;
- `?`, `[]`, `\` e parênteses em `commands` não têm equivalente e são
  recusados;
- as ferramentas de arquivo do Claude (`Read`, `Edit`, `Write`...) ficam
  liberadas, porque quem limita os caminhos é a sandbox;
- comandos que o Claude considera somente leitura (como `date` ou `ls`) rodam
  mesmo fora do `allow`; a sandbox continua limitando o que eles enxergam.

Qualquer outra forma é recusada antes de iniciar o provider.

## Workspace

O `Workspace` define onde o CLI do agente roda e o que ele enxerga do host. O
agente sempre roda isolado: não há modo sem sandbox. O `type` escolhe o
isolamento; em todos, o `cwd` do CLI é o `root`.

| Tipo | Isolamento | Campos |
| --- | --- | --- |
| `bubblewrap` | jaula `bwrap` no host | `root`, `writable?` |
| `docker` | container como jaula | `root`, `image`, `writable?` |

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
  root: '/home/dev/dev/goiaba/app',
  // Ex.: caches para bun/npm install funcionarem dentro da jaula.
  writable: [
    join(homedir(), '.bun/install/cache'),
    join(homedir(), '.npm'),
  ],
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
  root: '/home/dev/dev/goiaba/app',
  image: 'FROM oven/bun:latest',
});
```

## Configuração

A configuração do projeto fica em `goiaba.config.ts` na raiz. O env é um objeto
qualquer: as chaves string viram variáveis de ambiente (sem sobrescrever o
`process.env` já definido). `logDir` recebe o transcript JSONL da sessão. Com `debug: true`, cada sandbox
grava isolamento, imagem/container, volumes, montagens e rede; o executor
grava os comandos (inner, spawn, exit) e as tool calls do agente.
`GOIABA_DEBUG` e `GOIABA_LOG_DIR` também sobrescrevem o arquivo.

```ts
import { defineConfig } from './src/config/index.js';

export default defineConfig({
  logDir: 'logs',
  debug: false,
  envs: [
    {
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
    },
  ],
});
```
