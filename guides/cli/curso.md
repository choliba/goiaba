# Módulo cli: para que ele existe (o problema que resolve, em linguagem simples)

O módulo "cli" permite aprovar comandos negados pelo gate de forma interativa. Quando o sistema bloqueia uma operação por segurança, você precisa revisar e autorizar manualmente. O módulo oferece duas ferramentas: um comando para listar os negados e selecionar quais aprovar, e funções auxiliares para interpretar seleções como "1,3,5-8".

## Os arquivos (tabela: arquivo, papel)

| Arquivo                | Papel                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/cli/approvals.ts` | Define o comando executável que lista comandos negados e permite selecionar quais aprovar via interface interativa |
| `src/cli/selection.ts` | Fornece funções para analisar e validar seleções de usuários como "1,3,5-8" ou intervalos como "5-8"               |

## Como funciona (o caminho de uma chamada, do começo ao fim)

```
bun run approvals --root <diretorio>
  ↓
src/cli/approvals.ts:runCommand()
  ↓
src/cli/approvals.ts:defineCommand()
  ↓
src/cli/approvals.ts:run()
  ↓
src/approval/review.ts:ApprovalReview.run()
  ↓
src/cli/selection.ts:parseSelection() - analisa a entrada do usuário
```

1. O usuário executa `bun run approvals --root <diretorio>`
2. `approvals.ts` define o comando com nome "run approvals" e descrição em português
3. A função `run()` abre uma conexão com o banco de dados via `Store.open()`
4. Cria uma instância de `ApprovalReview` que lê as negações do gate
5. O usuário seleciona os comandos a aprovar usando notação "1,3,5-8"
6. `selection.ts:parseSelection()` converte a string para um array ordenado de índices

## Exemplo real (um trecho de quem usa o módulo no projeto, explicado)

O arquivo `src/approval/review.ts` importa e usa `parseSelection` de `cli/selection.ts`:

```
import { parseSelection } from '../cli/selection';
```

Esse arquivo recebe a seleção do usuário e processa os comandos aprovados. O fluxo completo é: o gate nega uma operação → `approval/review.ts` lista as negações → o usuário seleciona com `1,3,5-8` → `parseSelection()` converte para índices → os comandos são executados.

## Regras do módulo (o que só ele pode fazer, o que ninguém deve fazer fora dele)

**O que o módulo pode fazer:**

- Ler negações do gate via `Store.open()` e `ApprovalReview.run()`
- Interpretar seleções de usuários como listas ou intervalos numéricos
- Validar que os índices estejam dentro do tamanho da lista (1 a N)

**O que ninguém deve fazer fora dele:**

- Não interpretar seleções manualmente — sempre use `parseSelection(text, size)`
- Não executar aprovações sem passar pelo fluxo de `ApprovalReview`
- Não usar índices fora do intervalo válido (1 até o tamanho da lista)

## Exercícios

### Exercício 1: Entenda a notação de seleção

O módulo aceita seleções como "1,3,5-8". Se houver 10 comandos na lista, quais números são selecionados por cada token?

### Exercício 2: Validação de índice

A função `assertIndex` verifica que o índice esteja entre 1 e N. Qual mensagem de erro é exibida se alguém tentar selecionar o índice 0 em uma lista de 5 comandos?

### Exercício 3: Intervalo invertido

Se um usuário digitar "8-2" quando há 10 comandos, qual comportamento ocorre? O módulo aceita intervalos onde o primeiro número é maior que o segundo?
