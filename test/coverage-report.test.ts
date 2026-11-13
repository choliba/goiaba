import { describe, expect, test } from 'bun:test';

import {
  belowThresholds,
  coverageBadge,
  coverageMarkdown,
  moduleOf,
  parseLcov,
  ratchet,
  readThresholds,
  thresholdsJson,
  totalCoverage,
} from '../scripts/coverage-report';

const LCOV = `TN:
SF:src/a/um.ts
FNF:1
FNH:1
LF:4
LH:4
end_of_record
TN:
SF:src/a/dois.ts
FNF:2
FNH:1
LF:4
LH:2
end_of_record
TN:
SF:src/b/tipos.ts
FNF:0
FNH:0
LF:0
LH:0
end_of_record
`;

describe('a conta da cobertura', () => {
  test('lê o lcov arquivo por arquivo', () => {
    expect(parseLcov(LCOV)).toEqual([
      {
        file: 'src/a/um.ts',
        functionsFound: 1,
        functionsHit: 1,
        linesFound: 4,
        linesHit: 4,
      },
      {
        file: 'src/a/dois.ts',
        functionsFound: 2,
        functionsHit: 1,
        linesFound: 4,
        linesHit: 2,
      },
      {
        file: 'src/b/tipos.ts',
        functionsFound: 0,
        functionsHit: 0,
        linesFound: 0,
        linesHit: 0,
      },
    ]);
  });

  test('o total é a média por arquivo, com o arquivo sem nada a cobrir valendo 100, como o Bun', () => {
    // Functions: (100 + 50 + 100) / 3; lines: (100 + 50 + 100) / 3.
    const total = totalCoverage(parseLcov(LCOV));
    expect(total.functions).toBeCloseTo(83.333, 2);
    expect(total.lines).toBeCloseTo(83.333, 2);
  });

  test('o limite sobe até o medido, arredondado para baixo, e nunca desce', () => {
    const actual = { functions: 83.3333, lines: 90.129 };
    expect(ratchet(actual, { functions: 80, lines: 95 })).toEqual({
      functions: 83.33,
      lines: 95,
    });
    // Rounded down: the next run, with the same coverage, still passes.
    expect(
      belowThresholds(actual, ratchet(actual, { functions: 0, lines: 0 })),
    ).toBe(false);
    expect(belowThresholds(actual, { functions: 83.34, lines: 0 })).toBe(true);
  });

  test('os limites vêm de um JSON em porcentagem, e um JSON errado diz o formato', () => {
    expect(
      readThresholds(thresholdsJson({ functions: 91.24, lines: 93.56 })),
    ).toEqual({
      functions: 91.24,
      lines: 93.56,
    });
    expect(() => readThresholds('{ "lines": 90 }')).toThrow(
      '{ "functions": 90, "lines": 90 }',
    );
  });
});

describe('o relatório', () => {
  test('agrupa por módulo', () => {
    expect(moduleOf('src/mcp/broker.ts')).toBe('src/mcp');
    expect(moduleOf('rounds/web/src/route.ts')).toBe('rounds/web');
    expect(moduleOf('src/index.ts')).toBe('src');
  });

  test('o COVERAGE.md mostra os limites, o total, cada módulo e abre o que está abaixo de 100%', () => {
    const markdown = coverageMarkdown(
      parseLcov(LCOV),
      { functions: 83.33, lines: 83.33 },
      new Date(2026, 10, 13, 9, 5, 0),
    );
    expect(markdown).toContain('em 13/11/2026 09:05:00');
    expect(markdown).toContain('funções 83.33%, linhas 83.33%');
    expect(markdown).toContain('🟢|**Total**|83.33|83.33');
    expect(markdown).toContain('🟡|[src/a](src/a)|75.00|75.00');
    expect(markdown).toContain('<details open>\n<summary>🟡 <b>src/a</b>');
    expect(markdown).toContain('<details>\n<summary>🟢 <b>src/b</b>');
    expect(markdown).toContain('🟡|[dois.ts](src/a/dois.ts)|50.00|50.00');
  });

  test('o badge é a média das duas métricas', () => {
    expect(coverageBadge({ functions: 90, lines: 95 })).toEqual({
      schemaVersion: 1,
      label: 'coverage',
      message: '92.50%',
      color: 'brightgreen',
    });
    expect(coverageBadge({ functions: 40, lines: 50 }).color).toBe('red');
  });
});
