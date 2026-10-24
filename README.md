# Goiaba

Agente que analisa a pasta `app/` com o Codex.

O fluxo é dividido em três responsabilidades:

- `Executor` coordena o provider com o workspace e é o único responsável por
  executar processos;
- providers descrevem cada programa e interpretam suas respostas;
- `OutputStream<T>` e `OutputDispatcher<T>` são o único caminho das saídas
  brutas e interpretadas;
- `StandardOutput` adapta stdin/stdout na borda da aplicação.

O agente usa a saída padrão automaticamente: depois de instanciado, basta
chamar `run()`. `interact` permanece disponível para quem precisa consumir os
eventos direto.

```bash
bun run arquiteto
```

```ts
import {
  Agent,
  CodexProvider,
  Executor,
  OutputDispatcher,
  Workspace,
} from './src/index.js';

const output = new OutputDispatcher<string>();
const executor = new Executor({ output });
const agent = new Agent({
  prompt: 'Analise o projeto.',
  provider: new CodexProvider({ model: 'gpt-6.1-sol' }),
  workspace: new Workspace({
    type: 'unrestricted',
    root: '/home/dev/dev/goiaba',
  }),
  executor,
});

void (async () => {
  for await (const event of output.subscribe()) {
    console.log(event.executionId, event.programId, event.value);
  }
})();

await agent.run();
```

## Permissões

As permissões são definidas no próprio agente TypeScript. Quando presentes,
exigem um workspace `docker` ou `bubblewrap`; nenhuma política é reduzida
silenciosamente para best effort.

```ts
const agent = new Agent({
  prompt: 'Analise o projeto.',
  provider: new CodexProvider({ model: 'gpt-6.1-sol' }),
  workspace: new Workspace({
    type: 'bubblewrap',
    root: '/home/dev/dev/goiaba',
  }),
  permissions: {
    default: 'deny',
    allow: {
      filesystem: [{
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: {
          paths: ['/workspace/node_modules/**'],
        },
      }],
    },
    deny: {
      filesystem: [{
        operations: ['read', 'write'],
        paths: ['/workspace/.env'],
      }],
    },
  },
});
```

`ignores` retira somente a regra em que aparece; ele nunca concede acesso.
Entre regras aplicáveis, a precedência é `deny`, `requireApproval`, `allow` e,
por fim, `default`.

Todos os seletores usam exclusivamente padrões
[Git wildmatch](https://git-scm.com/docs/gitignore#_pattern_format), com matching
case-sensitive: `*` não atravessa `/`, `**` atravessa diretórios, `?` representa
um caractere, `[]` define classes e `\` escapa caracteres especiais. Não há
fallback para regex ou POSIX `fnmatch`. Para filesystem, `/workspace` representa
a raiz real do `Workspace`.

Nesta primeira versão, somente `filesystem` com `allow` e `deny` possui
enforcement. As demais categorias e `requireApproval` já fazem parte do motor,
mas são recusadas em `run()` enquanto não houver um interceptor anterior ao
efeito. O backend aceita o workspace completo como leitura ou leitura/escrita e
protege caminhos exatos ou árvores terminadas em `/**`; outras formas são
recusadas antes de iniciar o provider.

O `Workspace` escolhe o isolamento pelo `type`:

- `unrestricted` — executa o CLI no host, só troca o `cwd` para `root`.
- `docker` — envolve o comando em `docker run` com a imagem só como jaula. O CLI do host continua sendo usado, via `chroot` num filesystem host read-only. Só o `root` e o estado dos CLIs (`~/.config`, `~/.cursor`, `~/.codex`, cache) são graváveis. `image` deve ser `FROM <imagem>`; o Docker baixa qualquer referência.
- `bubblewrap` — envolve o binário do host com `bwrap`. Só entram o sistema (`/usr`, `/etc`, bins no PATH), o `root` do workspace e o estado dos CLIs (`~/.config`, `~/.cursor`, `~/.codex`, cache). O resto do host não é montado: `cd ..` a partir do `root` não lista o repositório pai. Precisa de Linux com user namespaces. A jaula fica de pé enquanto o `Workspace` existir (inclusive no `ask`). Com `debug: true`, o log traz `childPid` e o comando `nsenter` para entrar nela.

```ts
new Workspace({
  type: 'docker',
  root: '/home/dev/dev/goiaba',
  image: 'FROM oven/bun:latest',
});

new Workspace({
  type: 'bubblewrap',
  root: '/home/dev/dev/goiaba',
});
```

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
