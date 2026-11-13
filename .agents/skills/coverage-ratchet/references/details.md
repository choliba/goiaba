# Catraca de cobertura: detalhes

A catraca não só define números: ela impede que a cobertura caia sem ninguém ver. Os limites começaram em 0 e
subiram até o que o código alcançou.

## Como funciona

1. `bun run test:cov` é `bun test test/ --coverage && bun scripts/coverage-ratchet.ts`. O `&&` faz o script rodar só
   se os testes passaram.
2. O `bunfig.toml` (seção `[test]`) diz ao Bun os relatórios (`text` e `lcov`), a pasta (`coverage/`, fora do git),
   que os arquivos de teste não contam (`coverageSkipTestFiles`) e o que fica fora da conta
   (`coveragePathIgnorePatterns`).
3. O `scripts/coverage-ratchet.ts` lê `coverage/lcov.info`, calcula o total e o compara com
   `coverage-thresholds.json` (`{ "functions": …, "lines": … }`, em porcentagem). Abaixo, sai com 1 e não regrava
   nada; acima, sobe os limites e regrava `COVERAGE.md` e o badge. As contas, sem disco, ficam em
   `scripts/coverage-report.ts`, testadas em `test/coverage-report.test.ts`.

## Onde fica cada coisa

| Arquivo | Papel |
| ------- | ----- |
| `bunfig.toml` | Relatórios, pasta e exclusões da cobertura do Bun |
| `coverage-thresholds.json` | Os limites, que só sobem |
| `scripts/coverage-ratchet.ts` | A catraca: confere, sobe os limites, regrava `COVERAGE.md` e o badge |
| `scripts/coverage-report.ts` | As contas: lê o lcov, calcula o total, monta o `COVERAGE.md` e o badge |
| `COVERAGE.md` | O relatório por módulo e arquivo, versionado |
| `.github/badges/coverage.json` | O badge (endpoint do shields.io), versionado |

## Decisões de desenho

| Escolha | Alternativa não tomada | Motivo |
| ------- | ---------------------- | ------ |
| Limites em `coverage-thresholds.json`, conferidos pelo script | `coverageThreshold` no `bunfig.toml` | O do Bun vale para **cada arquivo**, não para o total: com um arquivo pouco coberto, qualquer limite acima dele falha sempre (conferido no Bun 1.4.2). O `global` do Jest, que o choliba usa, é o total. |
| O total é a média por arquivo, um arquivo sem nada a cobrir valendo 100 | Somar linhas e funções de todos os arquivos | É a conta do "All files" do Bun (conferida contra o lcov). Somar daria outro número, e o relatório não bateria com o que o Bun mostra. |
| Limite arredondado para baixo em 0,01 | Gravar o medido exato | Nunca fica acima do medido: a próxima execução, com a mesma cobertura, passa. |
| Funções e linhas | As quatro métricas do Jest | O Bun mede só essas duas; branches e statements não existem no lcov dele. |
| Não regravar nada numa execução abaixo do limite | Regravar sempre | Os arquivos mostram o último estado bom. |
| Regravar `COVERAGE.md`, badge e limites só quando o conteúdo muda (a linha da hora não conta) | Regravar sempre | Cada execução sujaria a árvore com uma hora nova. |
| Script em `scripts/`, pelo `src/filesystem` e pelo `src/output` | `node:fs` e `console` | A regra do AGENTS.md vale também para os scripts. |
| Agrupar por módulo (`src/mcp`, `rounds/web`…) | Por pacote | O Goiaba é um pacote só, com um módulo por pasta. |

## O que fica fora da cobertura, e por quê

Só o produto conta. Ficam fora os testes e o que eles criam em pastas temporárias (`test/**` e `../**`, os
`goiaba.config.ts` de mentira que os testes escrevem em `/tmp`), os exemplos (`agents/**`, `guides/**`), as rodadas
declaradas e as fixtures (`rounds/definitions/**`, `rounds/fixtures/**`) e a configuração do projeto (`config/**`,
`goiaba.config.ts`).

Não acrescente uma exclusão para um número subir. Excluir um arquivo com lógica esconde o que a catraca existe para
proteger; se alguém pedir isso, pare e confirme. Também não escreva testes que só executam declarações: teste
comportamento, inclusive os caminhos de erro.

## Extensão opcional de CI

Ainda não há workflow no repositório. No GitHub, um mínimo que roda o mesmo check e cobra os limites
(`.github/workflows/tests.yml`), sem gravar um limite que subiu:

```yaml
name: Tests

on:
  pull_request:
  push:
    branches: [develop, master]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run check
      - name: Relatório de cobertura (para investigar uma falha)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 5
```

Os testes do Goiaba usam bubblewrap e git; num runner do GitHub, alguns podem precisar de pacotes a mais
(`bubblewrap`). Para gravar o limite que subiu de volta no PR: depois do `bun run check`, faça `git add
coverage-thresholds.json COVERAGE.md .github/badges` e, só se o `coverage-thresholds.json` mudou, commit e push com
um token pessoal (um push com o `GITHUB_TOKEN` padrão não dispara outro workflow). Esse workflow não foi executado
no GitHub Actions: diga isso ao propô-lo.
