# Agentes

O agente é o centro do Goiaba. Ele junta estas peças e conversa com você:

| Peça                            | Papel                                                    | Padrão                                |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------- |
| [**provider**](#provider)       | a CLI que pensa e age                                    | — (obrigatória)                       |
| [**workspace**](#workspace)     | a sandbox onde a CLI roda e a pasta em que ela trabalha  | — (obrigatória)                       |
| [**permissions**](#permissions) | o que o agente pode fazer: arquivos, comandos, rede, web | nenhuma política: só a sandbox limita |
| [**interaction**](#interaction) | por onde você conversa com ele                           | o terminal                            |
| [**approve**](#approve)         | quem decide o que a política manda perguntar             | você, pelo `interaction`              |
| [**subscribe**](#subscribe)     | quem acompanha tudo o que acontece                       | ninguém                               |
| [**store**](#store)             | a memória: sessões, decisões e aprovações                | o banco do `goiaba.config.ts`         |
| [**signal**](#signal)           | quem pode pará-lo de fora                                | o Ctrl+C                              |

O Goiaba roda a CLI dentro da sandbox, aplica as permissões, pergunta a você o que a política
manda perguntar e guarda sessões, decisões e aprovações no banco.

## Agente básico

Um agente é um arquivo em `agents/`. Este conversa com o Codex num modelo local do Ollama, dentro do
bubblewrap:

```ts
import { Agent, OllamaProvider, Workspace } from '../src/index';

const agente = new Agent({
  name: 'dev',
  prompt: 'vamos conversar',
  provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
  workspace: new Workspace({
    type: 'bubblewrap',
    root: '/caminho/do/projeto',
  }),
});

await agente.run();
```

```bash
bun agents/meu-agente.ts
```

O agente responde ao `prompt` e espera a sua próxima mensagem; Ctrl+C encerra.

### O que importar o Goiaba já faz

Basta importar de `../src/index`:

- **carrega o `goiaba.config.ts`**: o log, o banco e as variáveis de ambiente (`envs`). Elas já valem
  no topo do arquivo, por exemplo `root: process.env['workspace']`;
- **mostra erros de uso como mensagem**, sem stack trace: uma política que o Goiaba não aplica, uma
  porta ocupada, `/` como raiz do workspace.

E o `run()`, sozinho, trata o Ctrl+C: o primeiro interrompe o agente e a sessão fica no banco para a
próxima execução; um segundo força a saída.

### `runScript` (opcional)

Serve para um script que quer:

- **outro `goiaba.config.ts`**: `runScript(fn, { config: { path: '...' } })`;
- **vários agentes com um log só e um Ctrl+C só**: os agentes criados dentro dele usam o `signal`
  dele.

```ts
await runScript(async () => {
  // Criados aqui dentro, usam o Ctrl+C do runScript.
  const agenteA = new Agent({ ... });
  const agenteB = new Agent({ ... });
  await Promise.all([agenteA.run(), agenteB.run()]);
});
```

## Agente completo

O mesmo agente com todas as peças à mostra. Cada uma pode ser omitida; o comentário diz o que vale
sem ela.

```ts
import { homedir } from 'node:os';

import {
  Agent,
  ClaudeProvider,
  humanApprover,
  join,
  StandardOutput,
  Workspace,
  type AgentOutput,
  type AgentPolicy,
} from '../src/index';

const politica: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read', 'write'], paths: ['/workspace/**'] }],
    execution: [{ commands: ['bun *', 'git status'] }],
    network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
  },
  requireApproval: {
    execution: [{ commands: ['git commit *'] }],
  },
};

// O terminal: único leitor do teclado e escritor da tela.
const terminal = new StandardOutput();
// Parar o agente de fora (aqui, depois de 30 minutos).
const parar = AbortSignal.timeout(30 * 60 * 1000);

const agente = new Agent({
  // Obrigatórias.
  name: 'dev',
  prompt: 'vamos conversar',
  provider: new ClaudeProvider({ model: 'claude-haiku-5-5' }),
  workspace: new Workspace({
    type: 'bubblewrap',
    root: process.env['workspace'] ?? '',
    // Caches dos gerenciadores de pacote, graváveis dentro da sandbox.
    writable: [join(homedir(), '.bun/install/cache'), join(homedir(), '.npm')],
    // Portas da sandbox abertas no 127.0.0.1 do host (um servidor que o agente sobe).
    ports: [5173],
  }),

  // O que ele pode fazer. Sem: só a sandbox limita.
  permissions: politica,
  // Quem decide o que a política manda perguntar. Sem: você, pelo interaction.
  approve: humanApprover(terminal, parar),

  // Conversa. Sem conversation: true. Sem interaction: o terminal.
  conversation: true,
  interaction: terminal,
  // Quem acompanha tudo. Sem: ninguém.
  subscribe: [
    (output: AgentOutput) => {
      if (output.type() === 'status') console.log(output.data());
    },
  ],

  // Quem para de fora. Sem: o Ctrl+C.
  signal: parar,
  // store: sem ele, o banco do goiaba.config.ts.
});

await agente.run();
```

## Agente numa API

O agente não depende do terminal: as peças que o ligam ao terminal (`interaction` e `approve`) podem
ligá-lo a uma API. O exemplo completo, que roda, está em [agents/api.ts](../agents/api.ts):

| Rota                                            | Para quê                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /mensagens` `{ "texto": "..." }`          | uma mensagem para o agente                                                          |
| `GET /eventos`                                  | o que o agente faz, ao vivo (Server-Sent Events): `mensagem`, `status`, `aprovacao` |
| `POST /aprovacoes/:id` `{ "resposta": "once" }` | a resposta a um pedido de aprovação                                                 |

**A conversa** passa por um `interaction` próprio. As mensagens que chegam pela API ficam numa fila;
o agente as lê com `ask` (no fim do turno) e `listen` (enquanto trabalha). O que ele escreve e o
status viram eventos:

```ts
const interaction: OutputAdapter = {
  write: (texto) => enviar('mensagem', { texto }),
  ask: (_pergunta, signal) => proxima(signal),
  listen: (signal) => proxima(signal),
  status: (texto) => enviar('status', { texto: texto ?? null }),
};
```

**As aprovações** passam por um `approve` próprio. Cada pedido vira um evento com um `id` e espera
a resposta chegar por `POST /aprovacoes/:id`:

```ts
function aprovarPelaApi(pedido: CommandApprovalRequest): Promise<ApprovalScope> {
  ultimoPedido += 1;
  const id = ultimoPedido;
  enviar('aprovacao', { id, ...pedido });
  return new Promise((resolve) => pendentes.set(id, resolve));
}

const agente = new Agent({ ..., interaction, approve: aprovarPelaApi });
```

Para conversar com ele:

```bash
bun agents/api.ts

# em outro terminal: acompanhar
curl -N http://127.0.0.1:3001/eventos

# mandar uma mensagem
curl -X POST http://127.0.0.1:3001/mensagens \
  -H 'content-type: application/json' -d '{"texto":"oi"}'

# responder a uma aprovação (o id vem no evento `aprovacao`)
curl -X POST http://127.0.0.1:3001/aprovacoes/1 \
  -H 'content-type: application/json' -d '{"resposta":"once"}'
```

Cuidados:

- **Quem não está conectado em `/eventos` perde o que já passou**: o exemplo não guarda histórico.
  Para isso, guarde os eventos ou use o `subscribe`.
- **Um `listen` que desiste** (o turno acabou) precisa sair da fila, senão a próxima mensagem vai para
  quem já não espera: é o que o `proxima(signal)` do exemplo faz.
- **O Ctrl+C** no terminal onde a API roda continua parando o agente.

## As peças

### provider

A CLI que pensa e age. O Goiaba a roda dentro da sandbox, conversa com ela e traduz a política para
a linguagem dela (arquivos de configuração, flags, hooks).

| Provider         | CLI                                             | Opções                                                                                                                |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ClaudeProvider` | Claude Code (`claude`)                          | `model`, `executable`                                                                                                 |
| `CodexProvider`  | Codex (`codex`)                                 | `model`, `executable`                                                                                                 |
| `CursorProvider` | Cursor (`agent`)                                | `model`, `executable`                                                                                                 |
| `OllamaProvider` | Claude Code ou Codex num modelo local do Ollama | `cli` (`'claude'` ou `'codex'`), `model`, `baseUrl` (padrão `http://127.0.0.1:11434`), `contextWindow` (padrão 32768) |

```ts
new ClaudeProvider({ model: 'claude-haiku-5-5' });
new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' });
```

O que muda de um provider para outro:

- **`web`**: quem aplica é a CLI. O Claude aplica por domínio no WebFetch; a WebSearch não aceita
  domínios, então uma regra que exclui domínios da busca a desliga. No Codex, a busca é hospedada pela
  OpenAI; no Ollama ela não existe e fica desligada.
- **`execution`**: o provider liga o hook da CLI ao gate do Goiaba, e cada comando é decidido pela
  política, igual em todas as CLIs.
- **Rede da própria CLI**: o endereço do modelo (a API, ou o Ollama) é sempre liberado. No Ollama, a
  nuvem da CLI (`chatgpt.com`, `api.anthropic.com`…) é bloqueada sem perguntar, porque não é usada.
- **Telemetria**: desligada no Claude e no Codex.
- O `CursorProvider` ainda não aplica `web` nem `execution`: com essas regras, o agente recusa ser
  criado.

### workspace

Onde a CLI roda: a sandbox e a pasta do projeto (`root`).

| Opção      | Tipo                         | Obrigatória  | Descrição                                                                                                      |
| ---------- | ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `type`     | `'bubblewrap'` ou `'docker'` | sim          | A sandbox.                                                                                                     |
| `root`     | `string`                     | sim          | A pasta do projeto: a única do host que o agente vê com escrita. Não pode ser `/`.                             |
| `image`    | `string`                     | só no docker | A imagem, escrita como `'FROM nome:tag'`.                                                                      |
| `writable` | `string[]`                   | não          | Outras pastas do host graváveis lá dentro (por exemplo, caches do bun e do npm).                               |
| `ports`    | `number[]`                   | não          | Portas da sandbox abertas no `127.0.0.1` do host: um servidor que o agente sobe, para você abrir no navegador. |

- **bubblewrap**: uma jaula que vive enquanto o agente roda; um servidor que o agente sobe continua no
  ar entre os turnos.
- **docker**: um container por turno; o que o agente deixa rodando morre no fim do turno.
- **Rede**: com regras de `network`, a sandbox fica sem rede própria e só sai pelo proxy do Goiaba
  (veja [permissions](#permissions)). Sem elas, usa a rede do host.
- **Um agente por vez**: enquanto um agente roda, o workspace fica ocupado (veja
  [Um workspace, um agente](#um-workspace-um-agente)).

```ts
new Workspace({
  type: 'docker',
  image: 'FROM oven/bun:latest',
  root: process.env['workspace'] ?? '',
  ports: [5173],
});
```

### permissions

O que o agente pode fazer: um `AgentPolicy`. Cada categoria tem regras em três listas, e o que
nenhuma regra cobre vai para o `default`.

```ts
const politica: AgentPolicy = {
  default: 'deny', // 'allow', 'deny' ou 'require_approval'
  allow: { ... },           // liberado sem perguntar
  requireApproval: { ... }, // pergunta antes (veja approve)
  deny: { ... },            // sempre negado, mesmo que outra regra libere
};
```

Uma regra diz o quê (`operations`), sobre o quê (caminhos, comandos, hosts, domínios…) e as exceções
(`ignores`). `/workspace` nos caminhos é o `root` do workspace.

| Categoria                          | Alvo                             | Quem aplica                        | Situação                                                                                                                     |
| ---------------------------------- | -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `filesystem`                       | `paths`                          | a sandbox                          | `allow` e `deny`; os caminhos de `deny` e de `ignores` precisam existir quando o agente começa. `requireApproval` ainda não. |
| `execution`                        | `commands`                       | o gate do Goiaba, pelo hook da CLI | completo                                                                                                                     |
| `network`                          | `hosts` (`host` ou `host:porta`) | o proxy do Goiaba                  | completo. `localhost:<porta>` é a porta do host (um servidor seu), alcançada por um túnel.                                   |
| `web`                              | `domains`                        | a CLI (veja [provider](#provider)) | depende do provider; `requireApproval` ainda não                                                                             |
| `secrets`                          | `secrets` (nomes de variáveis)   | a sandbox                          | completo: só as variáveis liberadas entram no ambiente da CLI; `requireApproval` vale como não liberada                      |
| `tools`, `agents`, `communication` | —                                | —                                  | ainda não: o agente recusa ser criado com essas regras                                                                       |

**Sem `permissions`, só a sandbox limita**: o agente lê e escreve o `root` inteiro, roda qualquer
comando e usa a rede do host.

**Segredos, com ou sem `permissions`:** da máquina, só entra na sandbox o que o provider precisa: as
pastas da CLI dele (o Claude, `~/.claude`; o Codex, `~/.codex`) e a credencial dela. O resto do
home (`~/.config`, perfis de navegador, outros logins) não está lá dentro, e o ambiente da CLI é
limpo: o básico do sistema, a credencial do provider e o que `secrets` liberar. Um agente do Ollama
não tem credencial nenhuma lá dentro. Um provider da nuvem precisa da dele para falar com o modelo:
essa, e só essa, fica disponível na sandbox. O que o Goiaba não consegue aplicar nunca é ignorado em silêncio: o
`new Agent` falha com a explicação (veja [Erros na criação](#erros-na-criação)).

### interaction

Por onde você conversa com o agente: um `OutputAdapter`. O padrão é o terminal (`StandardOutput`);
troque para levar a conversa a outro lugar, como um chat web.

| Método                            | Obrigatório | Para que serve                                                                                                               |
| --------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `write(texto)`                    | sim         | Mostrar o que o agente diz e os avisos do Goiaba.                                                                            |
| `ask(pergunta, signal?, teclas?)` | sim         | Esperar a sua resposta (e a próxima mensagem, numa conversa).                                                                |
| `listen(signal?)`                 | não         | Ler o que você digita enquanto o agente trabalha (mensagens, Ctrl+A). Sem ele, o que você digita espera o fim do turno.      |
| `choose(teclas, signal?)`         | não         | Escolha de uma tecla só (`u/s/w/n` das aprovações). Sem ele, a escolha é uma linha.                                          |
| `status(texto)`                   | não         | Uma linha reescrita no lugar: `⏳ pensando…`, `⏳ rodando em background…`. Sem ele, só o `pensando` aparece, como uma linha. |
| `width()`                         | não         | Largura da tela, para as tabelas (padrão 120).                                                                               |
| `close()`                         | não         | Liberar o teclado quando o agente termina.                                                                                   |

No terminal:

- **Ctrl+A** abre a tela de aprovações, a qualquer momento;
- **o que você digita enquanto o agente trabalha** é guardado e vai no próximo turno;
- **Ctrl+C** para o agente (veja [signal](#signal)).

### approve

Quem decide o que a política manda perguntar (`requireApproval`), para comandos e conexões de rede.
O padrão é perguntar a você pelo `interaction` (`humanApprover`):

```
┌─ 🤖 Solicitação de Execução do Agente
│  Comando: git commit -m "menu"
│  Motivo:  A ação corresponde a permissions.requireApproval.execution.
└─────────────────────────────────────────────────────────────
  Escolha uma opção:
    [u] Permitir uma vez
    [s] Permitir nesta sessão      (git *)
    [w] Permitir neste workspace   (git *)
    [n] Negar (padrão)
```

| Resposta    | Vale para                                                        |
| ----------- | ---------------------------------------------------------------- |
| `once`      | só esta vez                                                      |
| `session`   | esta sessão                                                      |
| `workspace` | este workspace, nas próximas execuções também (gravado no banco) |
| `deny`      | nega                                                             |

Um `approve` próprio recebe o pedido (`command`, `reason`, `pattern`, `provider`, `category`:
`'execution'` ou `'network'`) e devolve uma dessas respostas. Serve para aprovar sozinho, por exemplo
num teste:

```ts
approve: async ({ command }) => (command.startsWith('git ') ? 'once' : 'deny'),
```

O que o `default` nega (nenhuma regra cobre) não é perguntado na hora: vira um pedido pendente na tela
de aprovações (Ctrl+A), e o agente espera.

### subscribe

Funções que recebem **tudo** o que o agente reporta, enquanto acontece, cada coisa como um
`AgentOutput`:

| Método     | Devolve                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `type()`   | o que aconteceu: `output`, `ask`, `tool`, `command_decision`, `status`… |
| `data()`   | os dados daquele tipo                                                   |
| `ts()`     | quando, em ISO                                                          |
| `level()`  | `'debug'`, `'error'` ou nada                                            |
| `agent()`  | o próprio agente                                                        |
| `toJSON()` | o registro inteiro, como vai para o log                                 |

```ts
subscribe: [
  (output) => {
    if (output.type() === 'output') console.log(output.data()['value']);
  },
],
```

Os mais úteis:

| `type()`                            | `data()`                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| `output`                            | `value`: o que o agente escreveu                                  |
| `ask`                               | `question`: a pergunta para você                                  |
| `status`                            | `text`: a linha de status (`⏳ pensando…`), ou `null` quando some |
| `thinking`                          | `phase` (`start`, `tick` a cada 2 s, `end`) e `seconds`           |
| `tool`, `tool_result`, `tool_error` | a ferramenta, os argumentos, o resultado ou a falha               |
| `command_decision`                  | `command`, `decision`, `source`, `reason`                         |
| `network_decision`                  | `hostname`, `port`, `decision`, `source`, `reason`                |
| `error`                             | `message`                                                         |

Os `subscribe` recebem também o que é `debug`; a configuração `debug` só decide o que vai para o
arquivo de log. O `tick` do `thinking` é só para eles: não vai para o log.

### store

A memória do agente, num banco SQLite: sessões, decisões de comandos e de rede, e aprovações. É ela
que permite continuar uma conversa depois de um Ctrl+C e que guarda uma aprovação de workspace para
as próximas execuções.

O padrão é o banco do `goiaba.config.ts`:

```ts
database: { dir: join(storage, 'db'), name: 'goiaba.db' },
```

### signal

Quem pode parar o agente de fora: um `AbortSignal`. Quando ele é abortado, o agente mata a CLI, fecha
a sandbox e para; a sessão fica no banco.

- **Sem `signal`**, o `run()` usa o Ctrl+C: o primeiro para o agente, um segundo força a saída.
- **Dentro de um `runScript`**, o padrão é o Ctrl+C do script, compartilhado pelos agentes criados
  nele.
- **Um `signal` próprio** para por outro motivo, por exemplo um limite de tempo:

```ts
signal: AbortSignal.timeout(30 * 60 * 1000),
```

## O que acontece

**Ao criar (`new Agent`)**, a política é verificada e preparada para a sandbox e para a CLI. O que o
Goiaba ainda não sabe aplicar faz a criação falhar, com a explicação, para nenhuma regra ser
ignorada em silêncio.

**A cada `run()`:**

1. **Sessão.** Se uma tarefa com o mesmo `prompt` foi interrompida, ela continua de onde parou.
2. **Turno.** O Goiaba roda a CLI na sandbox com a sua mensagem e mostra o que ela responde. Os
   comandos e as conexões que a política manda perguntar aparecem para você aprovar.
3. **Próxima mensagem.** Terminado o turno, o agente espera você digitar. Em `conversation: false`,
   ele termina aqui.

## Opções

Tudo o que `new Agent({ ... })` aceita.

| Opção          | Tipo                | Obrigatória | Descrição                                                                                                                                                                                    |
| -------------- | ------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | `string`            | sim         | Nome do agente. Aparece em todo registro do log, nas sessões e na mensagem de quem ocupa um workspace.                                                                                       |
| `prompt`       | `string`            | sim         | A primeira mensagem. Também identifica a tarefa: rodar de novo com o mesmo `prompt` continua a sessão anterior (veja [Quando uma sessão é retomada](#quando-uma-sessão-é-retomada)).         |
| `provider`     | `Provider`          | sim         | A CLI que o agente usa: `ClaudeProvider`, `CodexProvider`, `CursorProvider` ou `OllamaProvider`.                                                                                             |
| `workspace`    | `Workspace`         | sim         | A sandbox (`bubblewrap` ou `docker`) e a pasta (`root`) em que a CLI trabalha. Um workspace aceita um agente por vez.                                                                        |
| `permissions`  | `AgentPolicy`       | não         | O que o agente pode fazer: arquivos, comandos, rede, web. **Sem ela, só a sandbox limita**: o agente lê e escreve o workspace inteiro, roda qualquer comando e usa a rede do host.           |
| `approve`      | `CommandApprover`   | não         | Quem decide o que a política manda perguntar (comandos e conexões). Recebe o pedido e devolve `'once'`, `'session'`, `'workspace'` ou `'deny'`. Padrão: perguntar a você pelo `interaction`. |
| `conversation` | `boolean`           | não         | Padrão `true`: depois de cada resposta, espera a próxima mensagem; termina só quando é parado. Com `false`, responde e termina, a não ser que esteja esperando uma aprovação.                |
| `interaction`  | `OutputAdapter`     | não         | Por onde você conversa: o que o agente mostra e o que você digita. Padrão: o terminal (`StandardOutput`). Troque para levar a conversa a outro lugar, como um chat web.                      |
| `subscribe`    | `AgentSubscriber[]` | não         | Funções que recebem tudo o que o agente reporta enquanto acontece: mensagens, ferramentas, comandos, decisões, status.                                                                       |
| `signal`       | `AbortSignal`       | não         | Quando é abortado, o agente para: mata a CLI e fecha a sandbox. Padrão: o do `runScript`, se houver; senão, o Ctrl+C.                                                                        |
| `store`        | `Store`             | não         | Onde ficam sessões, decisões e aprovações. Padrão: o banco do `goiaba.config.ts`.                                                                                                            |
| `executor`     | `Executor`          | não         | Avançada: quem inicia a CLI. Para testes e integrações.                                                                                                                                      |
| `output`       | `OutputDispatcher`  | não         | Avançada: quem distribui os eventos da CLI. Para testes e integrações.                                                                                                                       |

### Erros na criação

O `new Agent` falha com uma mensagem quando:

- a política tem regras que o Goiaba ainda não aplica (por exemplo, `tools` ou `agents`), ou que o
  provider não consegue aplicar;
- a política tem um valor inválido, como uma URL no lugar de um host;
- o workspace não consegue aplicar a política, por exemplo um caminho que não existe no workspace.

## Ciclo de vida

Um agente passa por cinco estados. `agente.status()` diz em qual ele está.

| Estado      | Quando                                                                            |
| ----------- | --------------------------------------------------------------------------------- |
| `idle`      | criado, terminou sozinho ou passou por um `reset()`: não há nada para continuar   |
| `running`   | em execução (`run()`)                                                             |
| `paused`    | interrompido com `pause()`: a sandbox continua aberta                             |
| `stopped`   | parado com `stop()` ou Ctrl+C: a sandbox foi fechada e a sessão continua no banco |
| `destroyed` | `destroy()`: não pode mais ser usado                                              |

### Métodos

| Método      | Retorno         | Descrição                                                                                                                                                                                                                                                                                                                                |
| ----------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run()`     | `Promise<void>` | Começa a conversa. Se a última sessão deste provider neste workspace tem o mesmo `prompt` e não terminou, **continua** de onde parou: é assim que se continua depois de `pause()`, `stop()` ou Ctrl+C. Com `conversation: true`, a Promise só termina quando o agente é parado. Chamado de novo enquanto roda, devolve a mesma execução. |
| `pause()`   | `Promise<void>` | Interrompe o turno atual e deixa a sandbox e o gate de aprovação abertos. O `run()` em andamento termina; um novo `run()` continua a sessão, na mesma sandbox.                                                                                                                                                                           |
| `stop()`    | `Promise<void>` | Encerra a execução e fecha a sandbox e o gate. A sessão continua no banco: o próximo `run()` continua de onde parou. O Ctrl+C faz o mesmo e o processo termina.                                                                                                                                                                          |
| `reset()`   | `Promise<void>` | Para o agente e encerra as sessões abertas deste provider neste workspace. O agente continua utilizável, e o próximo `run()` começa do zero.                                                                                                                                                                                             |
| `destroy()` | `Promise<void>` | Para o agente, encerra as sessões abertas e fecha o banco. O agente não pode mais ser usado, e a próxima execução do arquivo começa do zero.                                                                                                                                                                                             |
| `status()`  | `AgentStatus`   | O estado atual (tabela acima).                                                                                                                                                                                                                                                                                                           |

### Propriedades

Somente leitura: o que foi passado ao criar o agente.

| Propriedade | Tipo        | Descrição                 |
| ----------- | ----------- | ------------------------- |
| `name`      | `string`    | O `name` das opções.      |
| `prompt`    | `string`    | O `prompt` das opções.    |
| `provider`  | `Provider`  | O `provider` das opções.  |
| `workspace` | `Workspace` | O `workspace` das opções. |

### Quando uma sessão é retomada

Um `run()` continua a última sessão do mesmo provider no mesmo workspace quando:

1. ela tem **o mesmo `prompt`**; e
2. ela **não terminou**, ou terminou mas recebeu uma aprovação que o agente ainda não viu.

Ao retomar, o agente não recebe o `prompt` de novo, que já está no histórico da sessão. Recebe as
aprovações dadas enquanto ele estava parado e a instrução de continuar a tarefa.

Uma sessão só termina sozinha com `conversation: false`, quando o agente responde e não há nada
esperando aprovação. **Numa conversa (o padrão), a sessão fica aberta**: rodar o mesmo arquivo de
novo continua a conversa anterior. Para começar do zero, mude o `prompt`, ou chame `reset()` ou
`destroy()`.

### Um workspace, um agente

Enquanto um agente roda, ele ocupa o workspace. Outro agente no mesmo `root`, mesmo de outro
processo, falha com uma mensagem que diz quem está rodando e o pid para encerrá-lo. O workspace fica
livre quando o agente para.
