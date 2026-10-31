# Módulo command: para que ele existe (o problema que resolve, em linguagem simples)

O módulo `command` existe para separar **definição** de **execução**. Ele garante que:

1. A linha de comando seja **validada antes** de carregar configurações ou abrir logs — erros de uso terminam com código 1 imediatamente.
2. A ajuda (`--help`) seja construída automaticamente a partir da declaração, sem precisar escrever texto manualmente.
3. O comportamento do programa dependa apenas da linha de comando válida; se ela mudar, o programa muda.

Sem isso, cada comando precisaria: ler argumentos, validar, mostrar ajuda, carregar config, abrir log — tudo em um único lugar. Com `command`, a validação é centralizada e reutilizável.

## Os arquivos (tabela: arquivo, papel)

| Arquivo | Papel |
|---------|-------|
| `src/command/types.ts` | Define os tipos de argumentos/ops, o que uma declaração pode ter, e como o contexto chega ao `run`. |
| `src/command/parse.ts` | Lê a linha de comando, valida contra a declaração e devolve `{ args, options }` ou `{ help: true }`. |
| `src/command/help.ts` | Gera o texto da ajuda (`--help`) a partir da declaração. |
| `src/command/index.ts` | Exporta tudo e fornece `runCommand`, que executa um comando como script. |

## Como funciona (o caminho de uma chamada, do começo ao fim)

1. **Definição**: alguém chama `defineCommand({ name, description, args, options, run })`. Isso só descreve o que é permitido; não executa nada.
2. **Execução**: alguém chama `runCommand(definition, { argv })`.
3. **Parse**: `runCommand` chama `parseCommandLine(definition, argv)`.
   - Se `--help` ou `-h` estiver presente, devolve `{ help: true }`.
   - Caso contrário, devolve `{ args, options }` com os valores parseados.
4. **Ajuda**: se `{ help: true }`, `runCommand` chama `helpText(definition)` e escreve no output.
5. **Execução do script**: se não é ajuda, `runCommand` chama `definition.run(context)`, passando:
   - `args`: os argumentos parseados (tipados conforme a declaração).
   - `options`: as opções parseadas (booleans têm padrão `false`).
   - `signal`: para abortar em Ctrl+C.
   - `output`: o adaptador de saída único do programa.

Erros de uso (argumentos faltando, opção desconhecida) geram uma `UsageError`, que termina com código 1 e mostra a linha de uso correta.

## Exemplo real (um trecho de quem usa o módulo no projeto, explicado)

Veja `scripts/issue.ts`:

```ts
await runCommand(
  defineCommand({
    name: 'issue',
    description:
      'Abre uma issue no GitHub a partir de um Markdown com frontmatter.',
    args: {
      arquivo: { description: 'Markdown do plano', required: true },
    },
    options: {
      repo: {
        type: 'string',
        short: 'r',
        value: 'owner/nome',
        description: 'Repositório; vale mais que o repo do frontmatter',
      },
      dry: {
        type: 'boolean',
        short: 'd',
        description: 'Mostra a issue sem criá-la',
      },
    },
    run: async ({ args, options, output }) => {
      // ... lógica que usa args.arquivo e options.dry, options.repo ...
    },
  }),
);
```

- `args.arquivo` é **obrigatório** (tipado como `string`).
- `options.dry` é um booleano: se passado sem valor, recebe `false`; se passado como `--dry`, recebe `true`.
- `options.repo` aceita um valor (`--repo owner/repo` ou `-r owner/repo`).

Se alguém rodar `bun run issue --help`, o módulo gera automaticamente a ajuda mostrando:

```text
Uso: bun issue <arquivo> [opções]

Descrição: Abre uma issue no GitHub...

Argumentos:
  <arquivo>    Markdown do plano

Opções:
  -r, --repo <owner/nome>   Repositório; vale mais que o repo do frontmatter
  -d, --dry                 Mostra a issue sem criá-la
  -h, --help                Mostra esta ajuda
```

Sem `command`, esse texto precisaria ser escrito à mão e atualizado sempre que uma opção muda.

## Regras do módulo (o que só ele pode fazer, o que ninguém deve fazer fora dele)

- **Definição**: toda declaração de comando usa `defineCommand` com `{ name, description, args?, options?, run }`.
- **Execução**: todo comando é executado via `runCommand(definition, { argv?, onFailure, output })`.
- **Help**: a única forma de mostrar ajuda é passando `--help` ou `-h` na linha de comando; o módulo gera o texto automaticamente.
- **Erros de uso**: nunca tente validar argumentos fora do fluxo `parseCommandLine` → `runCommand`; use `UsageError` para mensagens de erro consistentes.
- **Contexto**: o `run` recebe um contexto único (`args`, `options`, `signal`, `output`); não pegue dados de fora (config, log) antes da validação.
- **Tipagem**: argumentos obrigatórios são sempre strings; booleans têm padrão `false`; opções com valor podem ser `string | undefined`.

## Exercícios

1. **Simples**: Crie um comando chamado `greet` que diz "Olá, <nome>!" usando `args.nome` (obrigatório) e uma opção `quiet` (booleano). O texto deve vir de `output.write`.

2. **Médio**: Adicione uma opção `format` com três valores possíveis: `plain`, `json`, `table`. A opção aceita um valor (`--format json`). No `run`, escolha a saída conforme o formato e mostre os argumentos parseados.

3. **Difícil**: Crie um comando que lê um arquivo de configuração local e valida se todas as opções obrigatórias estão presentes no arquivo. Se faltarem, use `UsageError`. Use `args.config` (obrigatório) e `options.verbose` (booleano).
