# Goiaba

![GitHub Created At](https://img.shields.io/github/created-at/choliba/goiaba?color=bright-green&style=flat-square)
![GitHub contributors](https://img.shields.io/github/contributors/choliba/goiaba?color=bright-green&style=flat-square)
[![license](https://img.shields.io/github/license/choliba/goiaba.svg?color=bright-green&style=flat-square)](LICENSE)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![cobertura](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/choliba/goiaba/develop/.github/badges/coverage.json&style=flat-square)](COVERAGE.md)

Roda agentes de código (Claude Code, Codex, Cursor e modelos locais pelo Ollama) a partir de scripts TypeScript,
sempre dentro de uma sandbox.

Um agente junta um **provider** (qual CLI roda), um **workspace** (a sandbox onde ela roda), uma **política** (o que
ela pode fazer) e uma **conversa** (com quem ela fala: o terminal, uma tela cheia ou um arquivo). Cada peça é um
módulo próprio, com um curso em [`guides/`](guides/).

## Índice

- [Segurança](#segurança)
- [Contexto](#contexto)
- [Instalação](#instalação)
- [Uso](#uso)
- [API](#api)
- [Contribuir](#contribuir)
- [Licença](#licença)

## Segurança

O agente sempre roda isolado (bubblewrap ou Docker): não há modo sem sandbox. A política (`AgentPolicy`) vale igual
para todos os providers, e nada dela é aplicado pela metade: o que um provider não sabe aplicar é recusado ao criar
o agente. Comandos em aberto são perguntados a você, e o gate de execução falha fechado (sem resposta, nega).
Por padrão, cada raiz usa seu próprio home persistente dentro de `workspaces.homes` (`.goiaba/homes`); só o arquivo de
login do provider entra nesse home e fica somente para leitura. Configure `hostState: 'none'` para não compartilhar
o arquivo de login (e fornecer uma credencial de ambiente), ou `hostState: 'share'` para compartilhar o estado do
host, gravável e com histórico de outros projetos. Segredos não chegam ao log. Veja os cursos de
[policy](guides/policy/README.md), [network](guides/network/README.md), [workspace](guides/workspace/README.md) e
[config](guides/config/README.md).

## Contexto

As CLIs de código são boas em trabalhar sozinhas, mas cada uma tem o seu jeito de rodar, de pedir permissão e de
mostrar o que faz. O Goiaba dá a todas o mesmo contrato: o mesmo agente, a mesma política, a mesma conversa e o
mesmo log, trocando só o provider.

## Instalação

Precisa do [Bun](https://bun.sh), de Linux com `bwrap` e `nsenter` (para o workspace `bubblewrap`) ou do Docker, e
da CLI que o agente vai usar (`claude`, `codex`, `agent` ou o [Ollama](https://ollama.com)).

```bash
bun install
```

### Em outro projeto

O Goiaba é um pacote: dá para instalá-lo em qualquer projeto que use o Bun. Do repositório, sem publicar:

```bash
bun add github:choliba/goiaba
```

Ou gere o pacote aqui (`bun pm pack`, que também gera as páginas das rodadas) e instale o arquivo lá
(`bun add ./goiaba-0.1.0.tgz`).

No outro projeto, a biblioteca vem de `goiaba` (e `goiaba/rounds`, `goiaba/config`), e o comando `goiaba` roda as
rodadas e serve as páginas:

```bash
bunx goiaba rounds <id>      # roda uma rodada de rounds/definitions
bunx goiaba rounds:web       # as páginas das rodadas, com os registros de rounds/data
bunx goiaba approvals        # revisa os comandos negados pelo gate
```

Cada comando lê o `goiaba.config.ts` do projeto. As rodadas precisam de `rounds.dir` (uma pasta fora do projeto) e
procuram as declarações, os pontos de partida e os registros em `rounds/definitions`, `rounds/fixtures` e
`rounds/data`, a menos que a config diga outros (`rounds.definitions`, `rounds.fixtures`, `rounds.data`).

## Uso

```ts
import {
  Agent,
  ClaudeProvider,
  join,
  runScript,
  Workspace,
} from '../src/index';
import { currentDirectory } from '../src/execute/process';

await runScript(async () => {
  await new Agent({
    name: 'analista',
    prompt: 'Analise o projeto.',
    provider: new ClaudeProvider({ model: 'claude-sonnet-5-5' }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: join(currentDirectory(), 'storage', 'workspace'),
    }),
  }).run();
});
```

No terminal, **Ctrl+A** abre as aprovações, **Ctrl+C** para o agente e **Ctrl+D** encerra a conversa. Os agentes
do projeto ficam em `agents/`:

```bash
bun run ollama claude   # um agente num modelo local, pela CLI do Claude Code
bun run tui codex       # o mesmo, em tela cheia, pela CLI do Codex
bun run approvals       # revisa e aprova comandos negados
```

A configuração do projeto fica em `goiaba.config.ts` (log, banco, workspaces e seus homes isolados, variáveis de ambiente); veja o curso de
[config](guides/config/README.md).

## API

Cada módulo tem um curso em `guides/<modulo>/README.md`, com exemplos que rodam como estão:

| Curso                                       | Sobre                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| [agent](guides/agent/README.md)             | o agente: opções, turnos, sessões, parar, `subscribe` |
| [providers](guides/providers/README.md)     | as CLIs: comandos, eventos, permissões                |
| [policy](guides/policy/README.md)           | a política: regras, decisões, aprovações              |
| [network](guides/network/README.md)         | a rede da sandbox                                     |
| [workspace](guides/workspace/README.md)     | a sandbox: bubblewrap e Docker                        |
| [interaction](guides/interaction/README.md) | a conversa                                            |
| [adapters](guides/adapters/README.md)       | as formas de conversar: stdio e arquivo JSONL         |
| [tui](guides/tui/README.md)                 | a conversa em tela cheia                              |
| [input](guides/input/README.md)             | o stdin                                               |
| [output](guides/output/README.md)           | a saída                                               |
| [execute](guides/execute/README.md)         | rodar programas                                       |
| [filesystem](guides/filesystem/README.md)   | disco e caminhos                                      |
| [events](guides/events/README.md)           | eventos dentro do processo                            |
| [rounds](guides/rounds/README.md)           | as rodadas: comparar agentes com fatos                |
| [context](guides/context/README.md)         | quem está rodando                                     |
| [config](guides/config/README.md)           | o `goiaba.config.ts`                                  |
| [command](guides/command/README.md)         | comandos de linha de comando                          |
| [cli](guides/cli/README.md)                 | os comandos do Goiaba                                 |

## Contribuir

As regras do projeto, para pessoas e agentes, estão no [AGENTS.md](AGENTS.md). Antes de entregar,
`bun run check` (typecheck, lint, formatação e testes) precisa passar.

Ao editar este arquivo, siga a especificação do [standard-readme](https://github.com/RichardLitt/standard-readme).

## Licença

[MIT](LICENSE).
