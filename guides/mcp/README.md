<a id="topo"></a>

# Módulo mcp: ferramentas do projeto para os agentes

Um agente do Goiaba roda dentro de um CLI (Claude Code, Codex) que já sabe ler arquivos, escrever e rodar comandos.
Às vezes ele precisa de algo que só o projeto tem: consultar um preço numa tabela, abrir uma página com um navegador de
verdade, gravar numa pasta específica. O módulo `mcp` é como o projeto dá essas **ferramentas próprias** ao agente.

Três ideias sustentam o módulo:

- **A ferramenta é uma função do projeto.** Você declara o nome, a descrição, a entrada (em JSON Schema) e o `run`. Ela
  roda **no processo do Goiaba**, fora da sandbox do agente, com o acesso que o Goiaba tem.
- **O CLI recebe a ferramenta por MCP** (Model Context Protocol). O Goiaba prepara um servidor MCP, o CLI o inicia
  dentro da sandbox, e cada chamada volta ao Goiaba por um socket. O protocolo é o do SDK oficial,
  `@modelcontextprotocol/server`, e só este módulo o conhece.
- **A política decide o que pode ser chamado.** A ferramenta tem um nome só, `goiaba/<nome>`, usado no `tools` do
  provider (o que o modelo enxerga) e no `AgentPolicy` (o que ele pode chamar). O que a política não libera nem aparece
  na lista do modelo.

```
modelo ── CLI (Claude Code, Codex) ──stdio/MCP──▶ servidor MCP ──socket──▶ ToolBroker ──▶ run()
          dentro da sandbox                       (server-main.ts,          (processo do     (fora da
                                                   SDK oficial)              Goiaba: política, sandbox)
                                                                             schema)
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [`AgentTool`, `tool` e `registerTool`](#agenttool-tool-e-registertool)
  - [A entrada: `ToolInputSchema`](#a-entrada-toolinputschema)
  - [`ToolBroker`](#toolbroker)
  - [`serveTools`](#servetools)
  - [No provider: `tools`](#no-provider-tools)
- [Como funciona](#como-funciona)
  - [Uma chamada, do modelo ao `run`](#uma-chamada-do-modelo-ao-run)
  - [Onde a ferramenta roda, e o que isso exige dela](#onde-a-ferramenta-roda-e-o-que-isso-exige-dela)
  - [Como cada CLI recebe o servidor](#como-cada-cli-recebe-o-servidor)
- [Exemplos](#exemplos)
  - [1. Registrar uma ferramenta](#1-registrar-uma-ferramenta)
  - [2. Ferramentas de tipos diferentes](#2-ferramentas-de-tipos-diferentes)
  - [3. A política](#3-a-política)
  - [4. Ler e escrever arquivos](#4-ler-e-escrever-arquivos)
  - [5. Acessar a web](#5-acessar-a-web)
  - [6. O servidor MCP, como o CLI o vê](#6-o-servidor-mcp-como-o-cli-o-vê)
  - [7. Um servidor MCP próprio](#7-um-servidor-mcp-próprio)
  - [8. Com um agente de verdade](#8-com-um-agente-de-verdade)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo                  | Papel                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/mcp/index.ts`       | O que o módulo exporta: `AgentTool`, `tool`, `registerTool`, `toolKey`, `registeredTool`, `ToolBroker`. |
| `src/mcp/schema.ts`      | `ToolInputSchema` e `inputProblem`: a entrada de uma ferramenta, conferida antes do `run`.              |
| `src/mcp/broker.ts`      | `ToolBroker`: o lado do Goiaba. Prepara o servidor e o socket, aplica a política e chama o `run`.       |
| `src/mcp/server.ts`      | `serveTools`: um servidor MCP de ferramentas, sobre o SDK oficial.                                      |
| `src/mcp/transport.ts`   | O transporte stdio do SDK, pelo `src/input` e pelo `src/output`.                                        |
| `src/mcp/server-main.ts` | O programa que o CLI inicia na sandbox: `serveTools` perguntando ao broker pelo socket.                 |
| `src/mcp/constants.ts`   | O nome do servidor (`goiaba`), o formato do nome de uma ferramenta, o tempo máximo de uma chamada.      |
| `agents/tools/*.ts`      | As ferramentas registradas do projeto, como `fetch_web_content`.                                        |

[↑ topo](#topo)

## Interface

Tudo sai de `src/mcp/index.ts`, menos o `serveTools`, que sai de `src/mcp/server.ts`.

### `AgentTool`, `tool` e `registerTool`

```ts
interface AgentTool {
  name: string; // consultar_ticket: letras minúsculas, números e _, começando por letra
  description: string; // o que ela faz e quando usar: é o que o modelo lê para escolhê-la
  input: ToolInputSchema; // a entrada, em JSON Schema de objeto
  run(input): ToolOutput | Promise<ToolOutput>; // o trabalho, no processo do Goiaba
}

type ToolOutput = string | number | boolean | object | null; // texto vai como está; o resto, como JSON
```

| Função                | O que faz                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `tool(definition)`    | Confere a declaração (nome, descrição, entrada de objeto) e a devolve. Errada, é um `UsageError`.   |
| `registerTool(def)`   | Confere e registra; devolve o nome `goiaba/<nome>` (`ToolKey`). O mesmo nome duas vezes é recusado. |
| `toolKey(name)`       | `consultar_ticket` → `goiaba/consultar_ticket`.                                                     |
| `registeredTool(key)` | A ferramenta registrada com esse nome; um `UsageError` que lista as registradas quando não há.      |
| `clearTools()`        | Esquece todas as registradas (para testes).                                                         |

Um erro lançado no `run` volta ao modelo como a falha da chamada, com a mensagem: escreva-a para o modelo entender o
que fazer.

### A entrada: `ToolInputSchema`

```ts
interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, JsonSchema>; // cada campo: type, description, enum, items…
  required?: readonly string[];
  description?: string;
  additionalProperties?: boolean; // false recusa campos que não estão em properties
}
```

O modelo vê o schema inteiro. Antes do `run`, o broker confere só o essencial e, se algo não cabe, devolve ao modelo o
motivo, para ele tentar de novo:

- a entrada é um objeto;
- os campos de `required` estão lá;
- cada campo declarado tem o `type` e, se houver, um dos valores do `enum`;
- com `additionalProperties: false`, nenhum campo a mais.

O resto (um formato, um intervalo de valores) o `run` confere.

### `ToolBroker`

O lado do Goiaba. Quem o cria é o `Agent`, a partir do `tools` do provider e da política; você o usa direto para testar
uma ferramenta sem modelo, como nos exemplos.

| Membro                              | O que faz                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `new ToolBroker({ tools, policy })` | As ferramentas declaradas e a política (`undefined` libera todas). Cria a pasta do servidor no cache. |
| `allowed()`                         | As ferramentas que a política libera: as únicas que o modelo vê.                                      |
| `call(name, input)`                 | Confere a política e a entrada, roda o `run` e devolve `{ text, isError }`.                           |
| `start()`                           | Empacota o servidor MCP na pasta e abre o socket.                                                     |
| `serverCommand()`                   | `{ name: 'goiaba', command: [bun, servidor, socket] }` (`ToolServer`): como o CLI inicia o servidor.  |
| `close()`                           | Fecha o socket e apaga a pasta.                                                                       |

### `serveTools`

```ts
serveTools(
  info: { name: string; version: string }, // como o servidor se apresenta no handshake
  handlers: {
    list(): Promise<readonly McpTool[]>; // { name, description, inputSchema }
    call(name, input): Promise<{ text: string; isError: boolean }>;
  },
): Promise<void>; // serve pelo stdio até o cliente fechar o stdin
```

É o servidor que o broker usa por dentro, e serve também sozinho, para qualquer cliente MCP. O SDK cuida do protocolo:
o handshake, a negociação da versão (da `2024-11-05` à `2026-07-28`), o `ping` e os erros. Quando o stdin fecha, os
pedidos que já chegaram ainda são respondidos antes de o servidor sair.

### No provider: `tools`

O agente vê uma ferramenta registrada quando o `tools` do provider a nomeia:

| Provider                                              | O que `tools` aceita                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `ClaudeProvider`, `OllamaProvider({ cli: 'claude' })` | As ferramentas do CLI (`file_read`, `shell`…) e as do projeto (`goiaba/…`). |
| `CodexProvider`, `OllamaProvider({ cli: 'codex' })`   | Só as do projeto: o Codex não deixa esconder as dele, que ele sempre tem.   |
| `CursorProvider`                                      | Ainda não recebe ferramentas registradas.                                   |

E pode chamá-la quando a política libera, na categoria `tools`:

```ts
policy: {
  default: 'deny',
  allow: { tools: [{ operations: ['call'], tools: ['goiaba/consultar_preco'] }] },
}
```

[↑ topo](#topo)

## Como funciona

### Uma chamada, do modelo ao `run`

1. **Antes do agente rodar**, o `Agent` pergunta ao provider quais ferramentas do projeto ele quer (`ownTools`), cria um
   `ToolBroker` com elas e com a política, sobe o servidor (`start`) e entrega ao provider o comando dele
   (`applyTools`). A pasta do servidor fica protegida, só para leitura, dentro da sandbox.
2. **O CLI inicia o servidor** dentro da sandbox e se apresenta (`initialize`). O servidor responde com o SDK.
3. **O CLI pede a lista** (`tools/list`). O servidor pergunta ao broker pelo socket, e o broker devolve só as que a
   política libera.
4. **O modelo escolhe uma e o CLI a chama** (`tools/call`). O servidor repassa ao broker, que confere a política de
   novo, confere a entrada pelo schema e roda o `run`.
5. **A resposta volta ao modelo**: o texto (ou o valor como JSON), marcada como erro quando o `run` lançou ou a entrada
   não cabia.

O tempo máximo de uma chamada é `TOOL_CALL_MS` (120 s): passou disso, o modelo recebe a falha.

### Onde a ferramenta roda, e o que isso exige dela

O `run` roda no processo do Goiaba, **fora da sandbox**. É por isso que uma ferramenta pode abrir uma página com um
navegador (que a sandbox não teria) ou ler uma pasta que o agente não enxerga. É também por isso que **a ferramenta é
responsável pelo que acessa**: a sandbox e o `policy.filesystem` do agente não a alcançam.

- **Arquivos:** prenda a ferramenta a uma pasta e recuse caminhos com `/` ou `..` ([Exemplo 4](#4-ler-e-escrever-arquivos)).
- **Web:** mantenha uma lista de sites permitidos dentro dela ([Exemplo 5](#5-acessar-a-web)). A rede da sandbox continua
  fechada: quem abre a página é o Goiaba.
- **Escrita:** prefira não sobrescrever sem que peçam, e diga no erro como pedir.

### Como cada CLI recebe o servidor

O servidor é o mesmo para todos; cada provider só traduz o comando para o seu CLI:

| CLI         | Como recebe                                                            |
| ----------- | ---------------------------------------------------------------------- |
| Claude Code | `--mcp-config '{"mcpServers":{"goiaba":{…}}}' --strict-mcp-config`     |
| Codex       | `-c mcp_servers.goiaba.command="…"` e `-c mcp_servers.goiaba.args=[…]` |

[↑ topo](#topo)

## Exemplos

Os exemplos estão em `guides/mcp/exemplos/` e rodam como estão (`bun guides/mcp/exemplos/<arquivo>.ts`). Do 1 ao 7,
nenhum precisa de modelo nem de internet: usam o `ToolBroker` e o servidor direto, como um CLI usaria. O 8 roda um
agente de verdade. As pastas de mentira ficam no cache do Goiaba e são apagadas no fim.

### 1. Registrar uma ferramenta

Uma calculadora. `registerTool` devolve o nome com que ela é usada em todo lugar; cada erro de declaração vira uma
mensagem que diz o que corrigir.

`guides/mcp/exemplos/1-registrar.ts`

```ts
/**
 * Exemplo 1 do curso de mcp: registrar uma ferramenta. `registerTool`
 * confere a declaração e devolve o nome com que ela é usada em todo lugar,
 * `goiaba/<nome>`: no `tools` do provider e na política. Uma declaração
 * errada é um UsageError que diz o que corrigir. Não roda nenhum agente.
 */
import { UsageError } from '../../../src/errors';
import { registerTool, type AgentTool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

/** Uma calculadora: soma dois números. */
const somar: AgentTool = {
  name: 'somar',
  description: 'Soma dois números e devolve o resultado.',
  input: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'A primeira parcela.' },
      b: { type: 'number', description: 'A segunda parcela.' },
    },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  run: (input: { readonly a: number; readonly b: number }) => input.a + input.b,
};

const key = registerTool(somar);
writeOut(`registrada: ${key}\n\n`);

/** Cada uma com um erro só, e a mensagem que ele dá. */
const wrong: [string, AgentTool][] = [
  ['nome com maiúsculas', { ...somar, name: 'Somar' }],
  ['sem descrição', { ...somar, name: 'somar_2', description: ' ' }],
  ['o mesmo nome de novo', somar],
];

for (const [label, definition] of wrong) {
  try {
    registerTool(definition);
    writeOut(`${label}: aceita\n`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    writeOut(`${label}:\n  ${error.message}\n`);
  }
}
```

Saída:

```
registrada: goiaba/somar

nome com maiúsculas:
  O nome da ferramenta "Somar" deve ter só letras minúsculas, números e _, começando por uma letra, como consultar_ticket.
sem descrição:
  A ferramenta somar_2 precisa de uma descrição: é o que o modelo lê para escolhê-la.
o mesmo nome de novo:
  Já há uma ferramenta registrada com o nome somar.
```

### 2. Ferramentas de tipos diferentes

Uma de texto (`contar_palavras`), uma de número com uma lista de opções que devolve um objeto (`converter_temperatura`)
e uma que falha (`dividir`). Depois, o que a conferência da entrada recusa antes de rodar o `run`.

`guides/mcp/exemplos/2-ferramentas-diferentes.ts`

```ts
/**
 * Exemplo 2 do curso de mcp: ferramentas de tipos diferentes, chamadas pelo
 * broker como o modelo as chamaria. Uma de texto, uma de número com uma
 * lista de opções, e uma que falha. Antes de `run`, o broker confere a
 * entrada pelo schema; o que não cabe volta ao modelo como erro, com o
 * motivo, para ele tentar de novo.
 */
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

/** Texto: conta as palavras de um texto. */
const contarPalavras = tool({
  name: 'contar_palavras',
  description: 'Conta as palavras de um texto.',
  input: {
    type: 'object',
    properties: { texto: { type: 'string' } },
    required: ['texto'],
    additionalProperties: false,
  },
  run: (input: { readonly texto: string }) =>
    `${String(input.texto.trim().split(/\s+/).length)} palavras.`,
});

/** Número com opções: converte uma temperatura e devolve um objeto. */
const converterTemperatura = tool({
  name: 'converter_temperatura',
  description: 'Converte uma temperatura entre Celsius e Fahrenheit.',
  input: {
    type: 'object',
    properties: {
      valor: { type: 'number' },
      para: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['valor', 'para'],
    additionalProperties: false,
  },
  run: (input: { readonly valor: number; readonly para: string }) =>
    input.para === 'fahrenheit'
      ? { fahrenheit: (input.valor * 9) / 5 + 32 }
      : { celsius: ((input.valor - 32) * 5) / 9 },
});

/** Uma que falha: o erro de `run` vira a resposta, marcada como erro. */
const dividir = tool({
  name: 'dividir',
  description: 'Divide a por b.',
  input: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  run: (input: { readonly a: number; readonly b: number }) => {
    if (input.b === 0) throw new Error('Não dá para dividir por zero.');
    return input.a / input.b;
  },
});

// Sem política: toda ferramenta declarada pode ser chamada.
const broker = new ToolBroker({
  tools: [contarPalavras, converterTemperatura, dividir],
  policy: undefined,
});

const calls: [string, unknown][] = [
  ['contar_palavras', { texto: 'goiaba com queijo é romeu e julieta' }],
  ['converter_temperatura', { valor: 30, para: 'fahrenheit' }],
  ['dividir', { a: 10, b: 4 }],
  ['dividir', { a: 1, b: 0 }],
  // O que o broker recusa antes de rodar:
  ['converter_temperatura', { valor: 30 }],
  ['converter_temperatura', { valor: '30', para: 'celsius' }],
  ['converter_temperatura', { valor: 30, para: 'kelvin' }],
  ['contar_palavras', { texto: 'oi', idioma: 'pt' }],
  ['traduzir', { texto: 'oi' }],
];

for (const [name, input] of calls) {
  const { text, isError } = await broker.call(name, input);
  writeOut(
    `${name} ${JSON.stringify(input)}\n  ${isError ? 'erro' : 'ok'}: ${text}\n`,
  );
}

// O broker guarda o servidor e o socket numa pasta do cache: close a apaga.
await broker.close();
```

Saída:

```
contar_palavras {"texto":"goiaba com queijo é romeu e julieta"}
  ok: 7 palavras.
converter_temperatura {"valor":30,"para":"fahrenheit"}
  ok: {"fahrenheit":86}
dividir {"a":10,"b":4}
  ok: 2.5
dividir {"a":1,"b":0}
  erro: Não dá para dividir por zero.
converter_temperatura {"valor":30}
  erro: Faltam campos obrigatórios: para.
converter_temperatura {"valor":"30","para":"celsius"}
  erro: O campo valor deve ser do tipo number.
converter_temperatura {"valor":30,"para":"kelvin"}
  erro: O campo para deve ser um de: celsius, fahrenheit.
contar_palavras {"texto":"oi","idioma":"pt"}
  erro: Campo desconhecido: idioma.
traduzir {"texto":"oi"}
  erro: A ferramenta traduzir não existe para este agente ou a política não a libera.
```

- Um objeto devolvido pelo `run` vai ao modelo como JSON (`{"fahrenheit":86}`); um texto, como está.
- Cada recusa diz o motivo, nas palavras que o modelo lê: o campo que falta, o tipo errado, o valor fora do `enum`, o
  campo a mais.

### 3. A política

Três ferramentas de tickets e quatro políticas. A ferramenta que a política não libera não aparece na lista do modelo e,
chamada mesmo assim, é recusada.

`guides/mcp/exemplos/3-politica.ts`

```ts
/**
 * Exemplo 3 do curso de mcp: a política decide quais ferramentas o agente
 * pode chamar. O broker nem lista as outras: o modelo não as vê. As regras
 * são as do AgentPolicy, na categoria `tools`, com o nome `goiaba/<nome>`.
 * Pedir aprovação é negar: dentro do servidor MCP ninguém aprova.
 */
import { ToolBroker, tool, type AgentTool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';
import type { AgentPolicy } from '../../../src/policy/policy.interface';

/** Ferramentas que só dizem o próprio nome: aqui importa quem as vê. */
const named = (name: string): AgentTool =>
  tool({
    name,
    description: `A ferramenta ${name}.`,
    input: { type: 'object' },
    run: () => name,
  });

const tools = [
  named('consultar_ticket'),
  named('fechar_ticket'),
  named('apagar_ticket'),
];

const policies: [string, AgentPolicy | undefined][] = [
  ['sem política', undefined],
  [
    'só consultar',
    {
      default: 'deny',
      allow: {
        tools: [{ operations: ['call'], tools: ['goiaba/consultar_ticket'] }],
      },
    },
  ],
  [
    'todas, menos apagar',
    {
      default: 'deny',
      allow: { tools: [{ operations: ['call'], tools: ['goiaba/*'] }] },
      deny: {
        tools: [{ operations: ['call'], tools: ['goiaba/apagar_ticket'] }],
      },
    },
  ],
  [
    'fechar pede aprovação',
    {
      default: 'allow',
      requireApproval: {
        tools: [{ operations: ['call'], tools: ['goiaba/fechar_ticket'] }],
      },
    },
  ],
];

for (const [label, policy] of policies) {
  const broker = new ToolBroker({ tools, policy });
  const seen = broker.allowed().map((found) => found.name);
  const call = await broker.call('apagar_ticket', {});
  writeOut(
    `${label}:\n  vê: ${seen.join(', ') || '(nenhuma)'}\n  apagar_ticket: ${call.isError ? call.text : 'chamada'}\n`,
  );
  await broker.close();
}
```

Saída:

```
sem política:
  vê: consultar_ticket, fechar_ticket, apagar_ticket
  apagar_ticket: chamada
só consultar:
  vê: consultar_ticket
  apagar_ticket: A ferramenta apagar_ticket não existe para este agente ou a política não a libera.
todas, menos apagar:
  vê: consultar_ticket, fechar_ticket
  apagar_ticket: A ferramenta apagar_ticket não existe para este agente ou a política não a libera.
fechar pede aprovação:
  vê: consultar_ticket, apagar_ticket
  apagar_ticket: chamada
```

- `goiaba/*` libera todas as ferramentas do projeto; o `deny` vale mais que o `allow`.
- `requireApproval` nega: dentro do servidor MCP não há ninguém para aprovar.

### 4. Ler e escrever arquivos

Duas ferramentas sobre uma pasta de notas: `ler_nota` lê uma (ou lista todas) e `salvar_nota` escreve, sem sobrescrever
a não ser que peçam. As duas recusam qualquer nome com pasta.

`guides/mcp/exemplos/4-arquivos.ts`

```ts
/**
 * Exemplo 4 do curso de mcp: ler e escrever arquivos. Duas ferramentas
 * sobre uma pasta de notas: `ler_nota` (lê uma, ou lista todas) e
 * `salvar_nota` (escreve, sem sobrescrever a não ser que peçam). `run`
 * roda no processo do Goiaba, fora da sandbox do agente: quem limita onde
 * elas leem e escrevem são elas mesmas. Por isso, só nomes de arquivo,
 * nunca um caminho com pasta ou `..`.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  listDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

// Uma pasta de notas de mentira, apagada no fim.
const notas = join(goiabaCacheDir(environment()), 'mcp-exemplo', randomUUID());
ensureDirectory(notas);
writeText(join(notas, 'compras.md'), 'goiaba\nqueijo minas\n');

/** O arquivo de uma nota; um erro (que o modelo lê) para um nome com pasta. */
function arquivoDe(nome: string): string {
  if (nome.includes('/') || nome.includes('\\') || nome.includes('..')) {
    throw new Error('Diga só o nome da nota, como compras.md, sem pastas.');
  }
  return join(notas, nome);
}

const lerNota = tool({
  name: 'ler_nota',
  description:
    'Lê uma nota pelo nome (como compras.md) e devolve o texto. Sem nome, lista as notas.',
  input: {
    type: 'object',
    properties: { nome: { type: 'string', description: 'O nome da nota.' } },
    additionalProperties: false,
  },
  run: (input: { readonly nome?: string }) => {
    if (input.nome === undefined) {
      return { notas: listDirectory(notas).toSorted() };
    }
    const arquivo = arquivoDe(input.nome);
    if (!pathExists(arquivo)) throw new Error(`Não há a nota ${input.nome}.`);
    return { nome: input.nome, texto: readText(arquivo) };
  },
});

const salvarNota = tool({
  name: 'salvar_nota',
  description:
    'Escreve uma nota. Uma nota que já existe só é trocada com substituir: true.',
  input: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'O nome da nota, como ideias.md.' },
      texto: { type: 'string', description: 'O conteúdo inteiro da nota.' },
      substituir: { type: 'boolean' },
    },
    required: ['nome', 'texto'],
    additionalProperties: false,
  },
  run: (input: {
    readonly nome: string;
    readonly texto: string;
    readonly substituir?: boolean;
  }) => {
    const arquivo = arquivoDe(input.nome);
    if (pathExists(arquivo) && input.substituir !== true) {
      throw new Error(
        `A nota ${input.nome} já existe: peça substituir: true para trocá-la.`,
      );
    }
    writeText(arquivo, input.texto);
    return `Nota ${input.nome} salva (${String(input.texto.length)} caracteres).`;
  },
});

const broker = new ToolBroker({
  tools: [lerNota, salvarNota],
  policy: undefined,
});

const calls: [string, unknown][] = [
  ['ler_nota', {}],
  ['ler_nota', { nome: 'compras.md' }],
  ['salvar_nota', { nome: 'ideias.md', texto: 'doce de goiaba com café\n' }],
  ['salvar_nota', { nome: 'compras.md', texto: 'só café\n' }],
  [
    'salvar_nota',
    { nome: 'compras.md', texto: 'goiaba\ncafé\n', substituir: true },
  ],
  ['salvar_nota', { nome: '../fora.md', texto: 'x' }],
  ['ler_nota', {}],
  ['ler_nota', { nome: 'compras.md' }],
];

try {
  for (const [name, input] of calls) {
    const { text, isError } = await broker.call(name, input);
    writeOut(
      `${name} ${JSON.stringify(input)}\n  ${isError ? 'erro' : 'ok'}: ${text}\n`,
    );
  }
} finally {
  await broker.close();
  removePath(notas);
}
```

Saída:

```
ler_nota {}
  ok: {"notas":["compras.md"]}
ler_nota {"nome":"compras.md"}
  ok: {"nome":"compras.md","texto":"goiaba\nqueijo minas\n"}
salvar_nota {"nome":"ideias.md","texto":"doce de goiaba com café\n"}
  ok: Nota ideias.md salva (24 caracteres).
salvar_nota {"nome":"compras.md","texto":"só café\n"}
  erro: A nota compras.md já existe: peça substituir: true para trocá-la.
salvar_nota {"nome":"compras.md","texto":"goiaba\ncafé\n","substituir":true}
  ok: Nota compras.md salva (12 caracteres).
salvar_nota {"nome":"../fora.md","texto":"x"}
  erro: Diga só o nome da nota, como compras.md, sem pastas.
ler_nota {}
  ok: {"notas":["compras.md","ideias.md"]}
ler_nota {"nome":"compras.md"}
  ok: {"nome":"compras.md","texto":"goiaba\ncafé\n"}
```

- A escrita passa pelo `src/filesystem` (`writeText`), como qualquer escrita do Goiaba.
- O erro de "já existe" diz ao modelo como pedir (`substituir: true`): ele lê e tenta de novo.

### 5. Acessar a web

`buscar_pagina` abre um endereço e devolve o status, o título e o tamanho. Só vai aos sites da sua lista. O exemplo sobe
um site local para rodar sem internet; a porta muda a cada vez e aparece como `<porta>`.

`guides/mcp/exemplos/5-web.ts`

```ts
/**
 * Exemplo 5 do curso de mcp: acessar a web. `buscar_pagina` abre um
 * endereço e devolve o título e o tamanho da página. Como `run` roda no
 * processo do Goiaba, a rede da sandbox do agente fica fechada: quem decide
 * aonde a ferramenta vai é ela, com uma lista de sites permitidos. Para o
 * exemplo rodar sem internet e dar sempre a mesma saída, ele sobe um site
 * local; a ferramenta de verdade do projeto, com um navegador, é a
 * `fetch_web_content` (agents/tools/fetch-web-content.ts).
 */
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

// Um site local, numa porta livre, com duas páginas.
const site = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/') {
      return new Response(
        '<html><head><title>Feira da Goiaba</title></head><body><h1>Ofertas</h1></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    return new Response('não achei', { status: 404 });
  },
});
const base = `http://127.0.0.1:${String(site.port)}`;

/** Os únicos sites aonde a ferramenta vai. */
const PERMITIDOS = new Set([`127.0.0.1:${String(site.port)}`]);

const buscarPagina = tool({
  name: 'buscar_pagina',
  description:
    'Abre uma página da web e devolve o status, o título e o tamanho dela.',
  input: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'O endereço completo.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  run: async (input: { readonly url: string }) => {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new Error(`Endereço inválido: ${input.url}.`);
    }
    if (!PERMITIDOS.has(url.host)) {
      throw new Error(`Esta ferramenta não acessa ${url.host}.`);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const html = await response.text();
    return {
      status: response.status,
      titulo: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? null,
      bytes: html.length,
    };
  },
});

const broker = new ToolBroker({ tools: [buscarPagina], policy: undefined });

const urls = [`${base}/`, `${base}/precos`, 'https://exemplo.com/', 'goiaba'];
try {
  for (const url of urls) {
    const shown = url.replace(base, 'http://127.0.0.1:<porta>');
    const { text, isError } = await broker.call('buscar_pagina', { url });
    writeOut(
      `${shown}\n  ${isError ? 'erro' : 'ok'}: ${text.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:<porta>')}\n`,
    );
  }
} finally {
  await broker.close();
  await site.stop();
}
```

Saída:

```
http://127.0.0.1:<porta>/
  ok: {"status":200,"titulo":"Feira da Goiaba","bytes":85}
http://127.0.0.1:<porta>/precos
  ok: {"status":404,"titulo":null,"bytes":9}
https://exemplo.com/
  erro: Esta ferramenta não acessa exemplo.com.
goiaba
  erro: Endereço inválido: goiaba.
```

- Uma página que responde 404 não é erro da ferramenta: o status vai na resposta, e o modelo decide.
- Para páginas de verdade, com JavaScript, o projeto tem a `fetch_web_content`
  ([`agents/tools/fetch-web-content.ts`](../../agents/tools/fetch-web-content.ts)), que abre a página num navegador.

### 6. O servidor MCP, como o CLI o vê

O broker sobe o servidor de verdade (empacotado, com o SDK), e o exemplo faz o papel do CLI: apresenta-se, pede a lista e
chama a ferramenta, em JSON-RPC pelo stdio.

`guides/mcp/exemplos/6-servidor-mcp.ts`

```ts
/**
 * Exemplo 6 do curso de mcp: o servidor MCP de verdade. O broker prepara o
 * servidor (empacotado, com o SDK oficial) e um socket; o CLI do agente o
 * inicia dentro da sandbox e conversa por stdio, em JSON-RPC, uma mensagem
 * por linha. Aqui o exemplo faz o papel do CLI: apresenta-se (initialize),
 * pede a lista e chama uma ferramenta. Cada chamada volta ao broker, no
 * processo do Goiaba, onde `run` executa.
 */
import { Executor } from '../../../src/execute/index';
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

const inverter = tool({
  name: 'inverter_texto',
  description: 'Devolve o texto de trás para frente.',
  input: {
    type: 'object',
    properties: { texto: { type: 'string' } },
    required: ['texto'],
  },
  run: (input: { readonly texto: string }) =>
    // Por letra como se lê, não por código: um emoji continua inteiro.
    Array.from(
      new Intl.Segmenter('pt-BR').segment(input.texto),
      (piece) => piece.segment,
    )
      .toReversed()
      .join(''),
});

const broker = new ToolBroker({ tools: [inverter], policy: undefined });
await broker.start();

// O que um CLI manda: apresentar-se, avisar que está pronto, listar, chamar.
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'exemplo', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inverter_texto', arguments: { texto: 'goiabada' } },
  },
];

try {
  // A linha de comando que o CLI usaria: `<bun> <servidor> <socket>`.
  const [executable = '', ...args] = broker.serverCommand().command;
  let stdout = '';
  for await (const { channel, chunk } of new Executor().run({
    executable,
    arguments: args,
    // Fechar o stdin no fim é o que encerra o servidor, como quando o CLI sai.
    input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n',
  })) {
    if (channel === 'stdout') stdout += chunk;
  }
  for (const line of stdout.trim().split('\n')) {
    writeOut(`${line}\n`);
  }
} finally {
  await broker.close();
}
```

Saída:

```
{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"goiaba","version":"2"}},"jsonrpc":"2.0","id":1}
{"result":{"tools":[{"name":"inverter_texto","description":"Devolve o texto de trás para frente.","inputSchema":{"type":"object","properties":{"texto":{"type":"string"}},"required":["texto"]}}]},"jsonrpc":"2.0","id":2}
{"result":{"content":[{"type":"text","text":"adabaiog"}],"isError":false},"jsonrpc":"2.0","id":3}
```

- O servidor respondeu com a versão que o cliente pediu (`2025-06-18`).
- O exemplo manda tudo e fecha o stdin: os pedidos que já chegaram ainda são respondidos.

### 7. Um servidor MCP próprio

`serveTools` sem broker: você diz quais ferramentas há e o que cada chamada devolve. Chamado com `servir`, o arquivo é o
servidor; sem argumento, ele se inicia como servidor e conversa consigo mesmo.

`guides/mcp/exemplos/7-servidor-proprio.ts`

```ts
/**
 * Exemplo 7 do curso de mcp: um servidor MCP próprio, com `serveTools`, sem
 * broker nem agente. Serve a qualquer cliente MCP (um CLI, um editor): você
 * diz quais ferramentas há (`list`) e o que cada chamada devolve (`call`); o
 * protocolo é do SDK oficial. Chamado com `servir`, este arquivo é o
 * servidor; sem argumento, ele se inicia como servidor e conversa com ele,
 * como um cliente faria.
 */
import { Executor } from '../../../src/execute/index';
import {
  programArguments,
  runtimeExecutable,
} from '../../../src/execute/process';
import { isRecord } from '../../../src/mcp/index';
import { serveTools, type McpTool } from '../../../src/mcp/server';
import { writeOut } from '../../../src/output/stdio';

const tools: readonly McpTool[] = [
  {
    name: 'formatar_reais',
    description: 'Escreve um valor em reais, como R$ 1.234,50.',
    inputSchema: {
      type: 'object',
      properties: { valor: { type: 'number' } },
      required: ['valor'],
    },
  },
  {
    name: 'maiusculas',
    description: 'Devolve o texto em letras maiúsculas.',
    inputSchema: {
      type: 'object',
      properties: { texto: { type: 'string' } },
      required: ['texto'],
    },
  },
];

if (programArguments()[0] === 'servir') {
  await serveTools(
    { name: 'utilidades', version: '1' },
    {
      list: () => Promise.resolve(tools),
      call: (name, input) => {
        if (name === 'formatar_reais' && typeof input['valor'] === 'number') {
          const text = input['valor'].toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
          return Promise.resolve({ text, isError: false });
        }
        if (name === 'maiusculas' && typeof input['texto'] === 'string') {
          return Promise.resolve({
            text: input['texto'].toLocaleUpperCase('pt-BR'),
            isError: false,
          });
        }
        return Promise.resolve({
          text: `Não sei chamar ${name} com essa entrada.`,
          isError: true,
        });
      },
    },
  );
} else {
  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'exemplo', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'formatar_reais', arguments: { valor: 1234.5 } },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'maiusculas', arguments: { texto: 'goiabada' } },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'maiusculas', arguments: { valor: 1 } },
    },
  ];
  let stdout = '';
  for await (const { channel, chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [import.meta.path, 'servir'],
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
  })) {
    if (channel === 'stdout') stdout += chunk;
  }
  for (const line of stdout.trim().split('\n')) {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) continue;
    writeOut(
      `${String(message['id'])}: ${JSON.stringify(message['result'])}\n`,
    );
  }
}
```

Saída:

```
1: {"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"utilidades","version":"1"}}
2: {"tools":[{"name":"formatar_reais","description":"Escreve um valor em reais, como R$ 1.234,50.","inputSchema":{"type":"object","properties":{"valor":{"type":"number"}},"required":["valor"]}},{"name":"maiusculas","description":"Devolve o texto em letras maiúsculas.","inputSchema":{"type":"object","properties":{"texto":{"type":"string"}},"required":["texto"]}}]}
3: {"content":[{"type":"text","text":"R$ 1.234,50"}],"isError":false}
4: {"content":[{"type":"text","text":"GOIABADA"}],"isError":false}
5: {"content":[{"type":"text","text":"Não sei chamar maiusculas com essa entrada."}],"isError":true}
```

### 8. Com um agente de verdade

Codex conduzindo um modelo local no Ollama, com a ferramenta `consultar_preco`. A tabela de preços só existe no Goiaba:
para responder, o modelo precisa chamar a ferramenta. Precisa do Ollama rodando com o `qwen3.5:4b` baixado e do Codex
instalado. A resposta do modelo varia de uma execução para outra.

`guides/mcp/exemplos/8-agente.ts`

```ts
/**
 * Exemplo 8 do curso de mcp: uma ferramenta nas mãos de um agente de
 * verdade. O provider vê a ferramenta porque o `tools` dele a nomeia, e pode
 * chamá-la porque a política a libera. Aqui, o Codex conduzindo um modelo
 * local no Ollama: o Codex recebe o servidor MCP por `-c mcp_servers…`, e
 * cada chamada volta ao Goiaba, onde `run` consulta a tabela. Precisa do
 * Ollama rodando, com o qwen3.5:4b baixado, e do Codex instalado.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import { registerTool } from '../../../src/mcp/index';
import { OllamaProvider } from '../../../src/providers/ollama/ollama-provider';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma consulta a uma tabela que só o Goiaba tem: o modelo não a vê. */
const PRECOS: ReadonlyMap<string, number> = new Map([
  ['goiaba', 7.9],
  ['queijo', 42.5],
  ['doce', 18],
]);

const CONSULTAR_PRECO = registerTool({
  name: 'consultar_preco',
  description: 'Consulta o preço do quilo de um produto da feira.',
  input: {
    type: 'object',
    properties: {
      produto: { type: 'string', description: 'O produto, como goiaba.' },
    },
    required: ['produto'],
    additionalProperties: false,
  },
  run: (input: { readonly produto: string }) => {
    const preco = PRECOS.get(input.produto.toLocaleLowerCase('pt-BR'));
    if (preco === undefined)
      throw new Error(`Não há preço para ${input.produto}.`);
    return { produto: input.produto, quilo: preco };
  },
});

// Uma pasta de trabalho de mentira, apagada no fim.
const root = join(goiabaCacheDir(environment()), 'mcp-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'feirante',
      resume: false,
      prompt:
        'Use a ferramenta consultar_preco para saber o preço do quilo da goiaba e diga quanto custam 2 quilos. Responda em uma frase.',
      provider: new OllamaProvider({
        cli: 'codex',
        model: 'qwen3.5:4b',
        contextWindow: 32768,
        tools: [CONSULTAR_PRECO],
      }),
      workspace: new Workspace({ type: 'bubblewrap', root, hostState: 'none' }),
      policy: {
        default: 'deny',
        allow: {
          filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
          tools: [{ operations: ['call'], tools: [CONSULTAR_PRECO] }],
        },
      },
    }).run();
  } finally {
    removePath(root);
  }
});
```

Saída:

```
💭 The user wants me to:
1. Use the ferramenta consultar_preco to find the price per kilo of goiaba (guava)
2. Tell them how much 2 kilos cost
3. Respond in one sentence
4. If I need any information from the user, ask only ONE direct question that ends with "?"
5. End the turn immediately after asking the question and do not continue with the task

Let me start by using the consultar_preco tool to get the price per kilo of goiaba.The price per kilo of goiaba is 7.9 (presumably in some currency). So 2 kilos would cost 7.9 * 2 = 15.8.

Now I can respond in one sentence as requested. The user wants me to use the ferramenta consultar_preco to find the price and tell them how much 2 kilos cost, all in one sentence.
A goiaba custa R$ 7,90 por quilo, logo 2 quilos custam R$ 15,80.
```

- O `💭` é o que o modelo pensou antes de responder. O R$ 7,90 veio da ferramenta.
- O Codex recebeu o servidor por `-c mcp_servers.goiaba…`; com `cli: 'claude'`, o mesmo exemplo funciona com
  `--mcp-config`.

[↑ topo](#topo)

## Regras do módulo

- **O SDK do MCP fica atrás do `src/mcp`.** Nenhum outro lugar importa `@modelcontextprotocol/server`, e o lint cobra.
- **Uma ferramenta tem um nome só, `goiaba/<nome>`**, o mesmo no `tools` do provider e na política.
- **A política decide no broker, no processo do Goiaba**, não no CLI: o que ela não libera não é listado nem chamado.
- **A ferramenta é responsável pelo que acessa.** Ela roda fora da sandbox: prenda arquivos a uma pasta e a web a uma
  lista de sites.
- **Erros para o modelo ler.** Uma recusa diz o que fazer, em português, para o modelo tentar de novo.
- **O stdio passa pelos donos dele.** O transporte do servidor lê pelo `src/input` e escreve pelo `src/output`.

[↑ topo](#topo)

## Exercícios

1. No [Exemplo 2](#2-ferramentas-de-tipos-diferentes), acrescente `kelvin` ao `enum` de `converter_temperatura` e trate o caso
   no `run`. Chame com `{ valor: 300, para: 'kelvin' }`: o que muda na resposta?
2. No [Exemplo 3](#3-a-política), escreva uma política que libere todas as ferramentas, menos as que começam com
   `apagar_` (dica: `ignores`).
3. No [Exemplo 4](#4-ler-e-escrever-arquivos), crie `apagar_nota`, que só apaga com `confirmar: true`. Que mensagem ela
   deve devolver sem a confirmação?
4. No [Exemplo 5](#5-acessar-a-web), faça `buscar_pagina` recusar respostas maiores que 100 KB, com um erro que diga o
   tamanho.
5. No [Exemplo 8](#8-com-um-agente-de-verdade), troque `cli: 'codex'` por `cli: 'claude'` e acrescente `file_read` ao
   `tools`. Por que, com o Codex, `file_read` é recusado?

[↑ topo](#topo)
