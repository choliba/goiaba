<a id="topo"></a>

# Módulo providers: ligar o Goiaba a uma CLI de agente

Um provider traduz a conversa do Goiaba para uma CLI específica. Ele monta o comando que executa um turno e converte
a saída da CLI em eventos que o agente entende. Assim, o restante do Goiaba trabalha com o mesmo contrato mesmo
quando Claude Code, Codex, Cursor ou Ollama falam formatos diferentes.

O provider descreve e interpreta o programa; quem o executa é `Executor`, e quem o limita é `Workspace` junto da
política. Criar um comando com `createCommand` **não inicia** a CLI.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [O contrato usado pelo agente](#o-contrato-usado-pelo-agente)
  - [Os tipos dos eventos](#os-tipos-dos-eventos)
  - [O contrato de provider em construção](#o-contrato-de-provider-em-construção)
- [Como funciona](#como-funciona)
  - [Do prompt aos eventos](#do-prompt-aos-eventos)
  - [Sessões e saída fragmentada](#sessões-e-saída-fragmentada)
  - [Política e sandbox](#política-e-sandbox)
  - [Acesso do provider ao host e à rede](#acesso-do-provider-ao-host-e-à-rede)
- [Exemplos](#exemplos)
  - [1. Descrever um provider](#1-descrever-um-provider)
  - [2. Inspecionar o comando](#2-inspecionar-o-comando)
  - [3. Interpretar a saída da CLI](#3-interpretar-a-saída-da-cli)
  - [4. Traduzir uma política](#4-traduzir-uma-política)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo                     | Papel                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                  | O contrato `Provider<TInput, TOutput>` atualmente usado pelo agente, os eventos, opções, descrição e `HostAccess`.                                                                                         |
| `provider.interface.ts`     | Uma interface mais ampla com `buildPermissions`; hoje Claude e Codex a implementam junto do contrato atual. O comentário no próprio arquivo registra que ela ainda não está conectada como contrato único. |
| `claude/claude-provider.ts` | Monta comandos para Claude Code, interpreta `stream-json`, traduz permissões e configura o hook de execução.                                                                                               |
| `claude/permissions.ts`     | Traduz `AgentPolicy` para as listas `allow`, `ask` e `deny` do Claude e relata o que não representa exatamente.                                                                                            |
| `codex/codex-provider.ts`   | Monta comandos Codex, interpreta JSONL, traduz permissões e liga o hook de execução.                                                                                                                       |
| `codex/permissions.ts`      | Traduz a política para configurações e regras nativas do Codex, registrando incompatibilidades.                                                                                                            |
| `cursor-provider.ts`        | Monta comandos e converte eventos JSON da CLI Cursor. A sandbox é o limite para os comandos executados por ela.                                                                                            |
| `ollama-provider.ts`        | Aponta Claude Code ou Codex para um servidor Ollama local, preservando o parser e os recursos da CLI interna.                                                                                              |

[↑ topo](#topo)

## Interface

### O contrato usado pelo agente

`src/providers/types.ts` exporta `Provider<TInput, TOutput>`. Para o agente hoje, os dois tipos são `string`: o prompt
entra como texto e a resposta também.

| Membro                                             | Obrigatório | O que faz                                                                                                                    |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                                               | sim         | Identifica o provider, por exemplo `claude`, `codex` ou `ollama-codex`.                                                      |
| `createCommand(input, sessionId?, workspaceRoot?)` | sim         | Devolve `ProgramCommand`: executável, argumentos, ambiente/redirecionamentos encapsulados e entrada. Não executa o processo. |
| `parseOutput(output)`                              | sim         | Converte um `AsyncIterable<ProgramOutput>` em eventos assíncronos.                                                           |
| `describe()`                                       | não         | Informa provider, modelo e, quando aplicável, a CLI.                                                                         |
| `networkEndpoints()`                               | não         | Endereços `host:porta` necessários para o provider funcionar.                                                                |
| `networkBlocked()`                                 | não         | Endereços que a CLI tenta acessar, mas que não são necessários e devem ser negados.                                          |
| `hostAccess()`                                     | não         | Estado, arquivos de credencial e variáveis de ambiente que a CLI precisa no host.                                            |
| `applyPermissions(policy, gate?)`                  | não         | Aplica na CLI categorias que a sandbox não consegue aplicar; pode retornar caminhos que precisam ficar protegidos.           |

`ProviderOptions` recebe `model` e, opcionalmente, `executable`. Cada provider pode acrescentar suas opções. Claude,
Codex e Cursor validam que o modelo não esteja vazio. Ollama também valida URL e janela de contexto.

### Os tipos dos eventos

`ProviderEvent<TOutput>` é o formato comum da saída:

| Evento    | Campos            | Significado                                                  |
| --------- | ----------------- | ------------------------------------------------------------ |
| `output`  | `value`           | Texto que o agente mostra.                                   |
| `ask`     | `question`        | Pergunta que espera resposta antes de continuar.             |
| `session` | `id`              | Identificador para retomar a conversa na próxima chamada.    |
| `tool`    | `phase`, `detail` | Chamada, resultado ou erro de ferramenta reportado pela CLI. |

Uma CLI pode enviar a resposta em várias partes. O parser deve montar os pedaços antes de produzir os eventos comuns.
`ProgramOutput` identifica se cada parte veio de `stdout` ou `stderr`; mensagens de diagnóstico em `stderr` também
podem virar `output`.

### O contrato de provider em construção

`provider.interface.ts` declara outro `Provider<TInput, TOutput, TPermissions>` e tipos para a tradução tipada da
política (`ProviderPermissions`, `UnsupportedRule`). Claude e Codex já implementam esse contrato e expõem
`buildPermissions`. Ele permite listar regras não expressas e dizer se a tradução fica mais restritiva ou mais
permissiva.

O agente ainda usa `Provider` de `types.ts`; Cursor e Ollama ainda não implementam o contrato mais amplo. Ao criar
uma integração, use a interface atual do agente e confira os métodos opcionais que ele consulta. Não trate a nova
interface como substituta já concluída.

[↑ topo](#topo)

## Como funciona

### Do prompt aos eventos

1. O agente chama `createCommand` com a mensagem e, se houver, o ID da sessão.
2. O executor inicia o processo descrito no `ProgramCommand`.
3. O provider lê os canais de saída e interpreta o formato da CLI.
4. `parseOutput` publica eventos comuns. O agente mostra texto, aguarda respostas e guarda IDs de sessão.

O provider não conhece a implementação do executor nem escreve na tela. Ele descreve o programa e interpreta o que
esse programa emitiu.

### Sessões e saída fragmentada

O `sessionId` opcional vai para a flag de retomada da CLI. Se a CLI informar um ID novo, o parser emite um evento
`session`. Se o processo entregar JSON em pedaços que não coincidem com linhas, o parser acumula os fragmentos até
formar um evento completo. O evento final sem quebra de linha também precisa ser processado.

Texto que termina em `?` é tratado como `ask` pelos parsers que classificam perguntas pelo formato do texto. Isso
permite ao agente pedir a resposta e passá-la ao próximo turno.

### Política e sandbox

A sandbox aplica os limites de filesystem e rede que o workspace suporta. Há categorias que ela não interpreta,
como as ferramentas web ou decisões sobre comandos executados dentro da CLI. Claude e Codex traduzem essas regras
para o formato próprio e conectam o hook do Goiaba para decisões de execução.

As funções `buildClaudePermissions` e `buildCodexPermissions` são traduções puras: devolvem regras nativas e uma
lista `unsupported`. `applyPermissions` configura o uso dessas regras pela CLI. Se o provider não consegue aplicar
uma categoria da política, deve falhar com `UsageError`, em vez de fingir que a regra foi aplicada.

Cursor não implementa `applyPermissions`; nesse caso, o limite de comandos é o da sandbox. Ollama delega ao provider
interno correspondente. Para Codex local, desliga a busca web hospedada: essa restrição é mais fechada que qualquer
permissão web e evita que a CLI local use a conta da nuvem.

### Acesso do provider ao host e à rede

`hostAccess` declara o estado da CLI que o workspace precisa montar e separa credenciais de arquivos comuns. Para
Ollama, o estado da CLI continua disponível, mas credenciais não são passadas: o modelo local não precisa do login
da nuvem.

`networkEndpoints` lista destinos necessários. O agente permite esses destinos pela fronteira de rede do
workspace. `networkBlocked` lista domínios supérfluos que uma CLI ainda tenta acessar; por exemplo, o provider
Ollama bloqueia os endpoints da nuvem do Claude ou do Codex. O proxy continua controlando os outros destinos pela
política de rede.

[↑ topo](#topo)

## Exemplos

Os exemplos são arquivos completos em `agents/meus-testes/providers-exemplos/`. Os quatro rodam sem iniciar uma CLI
de modelo nem acessar a rede: eles inspecionam o comando e alimentam o parser com saída de exemplo.

### 1. Descrever um provider

O método `describe` informa qual modelo e provider serão usados. Ele não inicia o modelo.

`agents/meus-testes/providers-exemplos/1-descrever.ts`:

```ts
/** Exemplo 1 do curso de providers: descrever um provider sem rodar a CLI. */
import { writeOut } from '../../../src/output/stdio';
import { ClaudeProvider } from '../../../src/providers/claude/claude-provider';

const provider = new ClaudeProvider({ model: 'claude-haiku' });
const description = provider.describe();

writeOut(`${description.name} / ${description.model}\n`);
```

```text
claude / claude-haiku
```

### 2. Inspecionar o comando

`createCommand` permite conferir executável e argumentos sem executá-los. O workspace pode ser fornecido quando a
CLI precisa saber qual pasta tratar como projeto.

`agents/meus-testes/providers-exemplos/2-comando.ts`:

```ts
/** Exemplo 2 do curso de providers: ver o comando que uma CLI receberia. */
import { writeOut } from '../../../src/output/stdio';
import { CursorProvider } from '../../../src/providers/cursor-provider';

const provider = new CursorProvider({ model: 'modelo-local' });
const command = provider.createCommand('Resuma o projeto.', undefined, '/app');

writeOut(`${command.executable} ${command.arguments?.join(' ')}\n`);
writeOut(`entrada: ${command.input?.split('\n')[0]}\n`);
```

```text
agent --print --output-format stream-json --model modelo-local --workspace /app --trust --force
entrada: Resuma o projeto.
```

### 3. Interpretar a saída da CLI

O parser não depende de uma sessão real: recebe o mesmo tipo de fluxo que o executor fornece. Aqui uma saída curta
de Cursor contém o ID de sessão e a resposta do assistente.

`agents/meus-testes/providers-exemplos/3-eventos.ts`:

```ts
/** Exemplo 3 do curso de providers: converter JSON da CLI em eventos. */
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';
import { CursorProvider } from '../../../src/providers/cursor-provider';

async function* cliOutput(): AsyncIterable<ProgramOutput> {
  yield {
    channel: 'stdout',
    chunk:
      '{"type":"system","subtype":"init","session_id":"sessao-1"}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Pronto."}]}}\n',
  };
}

const provider = new CursorProvider({ model: 'modelo-local' });

for await (const event of provider.parseOutput(cliOutput())) {
  if (event.type === 'session') writeOut(`sessão: ${event.id}\n`);
  if (event.type === 'output') writeOut(`resposta: ${event.value}\n`);
}
```

```text
sessão: sessao-1
resposta: Pronto.
```

### 4. Traduzir uma política

Uma tradução nativa inclui tanto as permissões resultantes quanto as regras que não couberam no formato do provider.
Neste caso, leitura da pasta e comando simples têm correspondência direta nas permissões do Claude.

`agents/meus-testes/providers-exemplos/4-politica.ts`:

```ts
/** Exemplo 4 do curso de providers: traduzir política para as regras do Claude. */
import type { AgentPolicy } from '../../../src/policy/policy.interface';
import { writeOut } from '../../../src/output/stdio';
import { buildClaudePermissions } from '../../../src/providers/claude/permissions';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/src/**'] }],
    execution: [{ commands: ['bun test'] }],
  },
};

const permissions = buildClaudePermissions(policy);

writeOut(`permitidas: ${permissions.native.allow.join(', ')}\n`);
writeOut(`não expressas: ${permissions.unsupported.length}\n`);
```

```text
permitidas: Read(./src/**), Bash(bun test)
não expressas: 0
```

[↑ topo](#topo)

## Regras do módulo

- `createCommand` descreve o processo; o `Executor` é quem o inicia.
- `parseOutput` transforma a saída específica de uma CLI em `ProviderEvent` e precisa aceitar fragmentos e o trecho final incompleto.
- Preserve o ID de sessão que a CLI fornece para permitir retomada.
- Traduza políticas de forma explícita. Registre incompatibilidades e recuse uma política que não pode ser aplicada com segurança.
- Declare apenas os endpoints de rede, arquivos de estado, credenciais e variáveis realmente necessários.
- Não escreva diretamente no terminal dentro do provider. Produza eventos; quem usa o provider escolhe como mostrá-los.
- Mantenha o provider independente de agente, workspace e executor concretos.

[↑ topo](#topo)

## Exercícios

1. Crie um provider com `id`, `describe` e `createCommand`; confira o comando sem executá-lo.
2. Escreva um `AsyncIterable<ProgramOutput>` com duas partes de uma linha JSON e verifique que `parseOutput` emite um evento só quando a linha se completa.
3. Faça o parser emitir um evento `session` e depois uma resposta `ask` que termine em interrogação.
4. Traduza uma regra não suportada para Claude ou Codex e examine o `unsupported`: qual efeito ela teria se fosse ignorada?
5. Compare `hostAccess` e `networkEndpoints` entre Claude e Ollama. Que acesso da conta de nuvem desaparece no modelo local?

[↑ topo](#topo)
