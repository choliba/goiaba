---
name: coverage-ratchet
description: Explica e opera com segurança a catraca de cobertura do Goiaba (limites que só sobem) — coverage-thresholds.json, bunfig.toml, COVERAGE.md, o badge do shields e o scripts/coverage-ratchet.ts. Use quando a cobertura falhar ou cair, quando pedirem para mudar um limite ou tirar um arquivo da cobertura, quando o COVERAGE.md ou o badge parecerem errados, ao montar a cobertura num CI, ou quando perguntarem por que os números não podem descer.
argument-hint: 'A falha de cobertura, ou a mudança de limite/exclusão em questão.'
user-invocable: true
disable-model-invocation: false
---

# Catraca de cobertura

A cobertura do Goiaba não pode cair sem ninguém ver. Os limites ficam em `coverage-thresholds.json` (versionado),
sobem sozinhos até o que uma execução que passou alcançou, e uma execução abaixo deles falha.

## O ciclo, em cinco linhas

1. `bun run test:cov` roda `bun test test/ --coverage` e, se os testes passaram, o `scripts/coverage-ratchet.ts`.
   O `bun run test` sozinho pula tudo isso, para o ciclo de TDD continuar rápido. O `bun run check` usa o `test:cov`.
2. O Bun mede funções e linhas e escreve `coverage/lcov.info`. O script calcula o total como o "All files" do Bun
   (a média por arquivo, um arquivo sem nada a cobrir valendo 100) e o compara com `coverage-thresholds.json`.
3. Abaixo de qualquer limite, a execução falha (saída 1) e nada é regravado: os arquivos mostram sempre o último
   estado bom.
4. Numa execução que passou, cada limite sobe para `max(atual, medido)`, métrica por métrica, arredondado para baixo
   em 0,01 (nunca acima do medido, senão a próxima execução falharia sem nada piorar). Nunca desce sozinho.
5. O mesmo script regrava `COVERAGE.md` (tabela por módulo e arquivo) e `.github/badges/coverage.json` (badge), só
   quando o conteúdo muda (a hora da geração não conta), então rodar os testes deixa a árvore limpa.

Versione `coverage-thresholds.json`, `COVERAGE.md` e `.github/badges/`. Não edite o `COVERAGE.md` à mão.

## Quando a cobertura falha

A correção é um teste, não um número. Veja no `COVERAGE.md` (ou na tabela que o `bun test --coverage` mostra) o
arquivo e as linhas sem cobertura, ache o caminho de erro ou o ramo que ninguém exercita, e escreva um teste que o
exercite por um comportamento de verdade. Não escreva testes que só executam declarações para inflar a
porcentagem: eles sobem o limite sem proteger nada, e a catraca trava esse número oco.

## O que precisa do aval explícito de quem usa

- **Baixar um limite** em `coverage-thresholds.json`. A graça é que isso seja deliberado e visível. Sugira só com um
  motivo real e entendido, e mexa só na métrica que a pessoa disser.
- **Acrescentar uma exclusão** em `coveragePathIgnorePatterns`, no `bunfig.toml`. Hoje ficam de fora: os testes e o
  que eles criam em pastas temporárias (`test/**`, `../**`), os exemplos (`agents/**`, `guides/**`), as rodadas
  declaradas e as fixtures delas (`rounds/definitions/**`, `rounds/fixtures/**`) e a configuração do projeto
  (`config/**`, `goiaba.config.ts`). Excluir um arquivo com lógica esconde justamente o que a catraca protege. Se um
  arquivo é difícil de cobrir, isso costuma ser um sinal de desenho: leve a lógica para um módulo testável.

## Decisões de desenho

Os limites começaram em 0 e a catraca os subiu até o que o código alcançou. As escolhas (por que o limite não fica
no `bunfig.toml`, por que a média por arquivo, o arredondamento para baixo, a regravação só quando muda) estão em
`references/details.md`, junto com o passo opcional de CI. Leia antes de mexer no script.

## Relacionado

`AGENTS.md` para o `bun run check` inteiro (typecheck, lint, formatação e testes com cobertura).
