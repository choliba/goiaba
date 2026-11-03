# Regras do projeto

Valem para quem escreve código no Goiaba: pessoas e agentes. O `bun run check` cobra parte delas (veja
[O que o lint cobra](#o-que-o-lint-cobra)); o resto depende de quem escreve.

## Cada capacidade tem um dono

Tudo o que o Goiaba faz com o mundo de fora passa por **um módulo só**. Ninguém mais faz aquilo por conta própria.

| Capacidade                                                                                                                      | Dono                                                                                           | Ninguém mais                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| disco e caminhos                                                                                                                | `src/filesystem`                                                                               | importa `node:fs` ou `node:path`               |
| rodar programas                                                                                                                 | `src/execute` (`Executor`, `runProgram`, `startHelper`, `runAttached`)                         | importa `node:child_process`                   |
| o processo atual (argumentos, ambiente, diretório, sinais, código de saída, a limpeza na saída)                                 | `src/execute/process.ts` (`onProgramExit`)                                                     | toca em `process`                              |
| a saída: para onde vai o que o programa mostra                                                                                  | `src/output` (`Output`; stdio é o destino `stdioOutput`)                                       | escreve na saída por conta própria             |
| escrever no stdout e no stderr (stdio), e o que só um tty tem                                                                   | `src/output/stdio.ts`                                                                          | usa `console` ou `process.stdout`              |
| ler o stdin (só a fonte: `read`, `readStream`)                                                                                  | `src/input`                                                                                    | abre outro leitor do stdin                     |
| a conversa no stdio: o que chega (teclas, linha digitada, colagem, linhas de um pipe) vira evento, e o que sai vai para o stdio | `src/adapters/stdio` (`StdioAdapter`; a digitação num terminal, `Typing`, serve também ao TUI) | interpreta os bytes do stdin por conta própria |
| a conversa com quem usa (perguntar, ouvir, mostrar), sem saber por onde ela passa                                               | `src/interaction` (`Interaction`; `Conversation` sobre um `InteractionAdapter`)                | conversa direto com o terminal                 |
| a conversa em tela cheia                                                                                                        | `src/adapters/tui` (`TuiAdapter`, um `InteractionAdapter`)                                     | desenha uma tela cheia por conta própria       |
| a conversa por um arquivo (JSONL)                                                                                               | `src/adapters/jsonl` (`JsonlAdapter`, um `InteractionAdapter`)                                 | conversa por arquivo por conta própria         |
| log                                                                                                                             | `src/logger`                                                                                   | grava log por conta própria                    |
| configuração do projeto                                                                                                         | `src/config`                                                                                   | lê o `goiaba.config.ts`                        |
| eventos dentro do processo                                                                                                      | `src/events`                                                                                   | cria outro barramento                          |
| permissões                                                                                                                      | `src/policy` (`AgentPolicy`, o modelo único)                                                   | define outro modelo de permissão               |

**Por quê:** um lugar só para cada coisa é o que permite trocar como ela é feita, saber quem a usa e confiar no que
ela garante. Um leitor do terminal a mais já travou um agente (as teclas iam para o leitor errado).

Um pacote de terceiros fica **atrás** do dono, nunca espalhado: o logger aceita pino, winston ou LogTape pelo
`logger.use` do `goiaba.config.ts`, e só o `src/logger` sabe disso. Scripts (`scripts/`), exemplos (`agents/`) e o
próprio `goiaba.config.ts` seguem a mesma regra.

## Módulos desacoplados

- **Um módulo deve poder ser usado sozinho.** Ele depende do mínimo: o `execute` roda um `ProgramCommand` sem
  conhecer provider nem sandbox; o `network` recebe só as regras de rede, não a política inteira.
- **Quem junta as peças é quem as usa.** O agente compõe provider, workspace e executor (`runProvider`); o
  workspace monta a fronteira de rede a partir da política.
- **Cada um recebe só a sua parte.** A política é uma só (`AgentPolicy`), e cada aplicador recebe o pedaço dele
  (`networkRulesOf(policy)`, `compileFilesystemAccess(policy, root)`).
- **Quem produz um dado decide para onde ele vai**, inclusive o log. O logger não conhece produtor nenhum (não há
  `log.command`); o gate de rede emite o evento e grava o próprio log.
- **Log não é I/O.** Entrada e saída são a conversa com quem usa o programa. O log é transversal: está disponível
  desde o início de qualquer coisa, e não passa pelo `output`.
- **Eventos são entre produtores e consumidores que não se conhecem:** `createProducer('nome')` emite,
  `createConsumer(fn).subscribe('nome')` recebe só o que assinou.

## Código

- Código e comentários em inglês; o que o usuário lê (mensagens de erro, ajuda, cursos) em português.
- Um erro de uso (configuração errada, política que não pode ser aplicada) é um `UsageError`, com uma mensagem que
  diga o que fazer. Uma opção desconhecida é recusada, nunca ignorada em silêncio.
- Valores padrão (limites, intervalos, tamanhos, caminhos) moram no `constants.ts` do módulo, cada um com um
  comentário que diz o que é, em que unidade e por que tem aquele valor. Quem cria o objeto pode trocar o valor
  por uma opção (`maxRecordBytes`, `killGraceMs`…); sem a opção, vale o padrão. Valores de protocolo ou de
  segurança (códigos HTTP, permissão de um arquivo de log) também moram lá, mas sem opção.
- Antes de entregar: `bun run check` (typecheck, lint, formatação e testes) passando.

## Cursos (`guides/`)

Siga a skill [`.agents/skills/guias-exemplos-completos`](.agents/skills/guias-exemplos-completos/SKILL.md): todo
exemplo é completo e roda como está, com a saída real; o curso tem índice, link para o topo e seção de Interface.
Os exemplos moram ao lado do curso, em `guides/<modulo>/exemplos/`, e passam pelo `bun run check` como o resto do
código.

## Git e GitHub

- Trabalho na `develop`; a `master` avança junto, por fast-forward. Nada vai para o remoto sem pedido explícito.
- Issues e commits não levam o nome de quem usa o projeto, nem em exemplos de log ou caminhos (`/home/<usuário>`):
  use nomes neutros (`dev`, `assistente`, `/…/app`).

## O que o lint cobra

O `.oxlintrc.json` tem a regra `no-restricted-imports`:

| Import                                     | Só em            |
| ------------------------------------------ | ---------------- |
| `node:fs`, `node:fs/promises`, `node:path` | `src/filesystem` |
| `node:child_process`                       | `src/execute`    |
| `node:readline`                            | `src/input`      |

A regra vale para `src/`, `agents/`, `scripts/` e os exemplos dos cursos (`guides/`). Os testes (`test/`) estão fora
da regra: montam arquivos e processos de teste à mão. As outras regras deste
documento (`console`, `process`, o desacoplamento) ainda não são verificadas automaticamente.
