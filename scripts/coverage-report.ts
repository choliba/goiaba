/**
 * The coverage ratchet's arithmetic, with no disk: the lcov `bun test
 * --coverage` writes, read into files; the totals as Bun computes them; the
 * thresholds raised to what a passing run reached; COVERAGE.md and the
 * shields badge. scripts/coverage-ratchet.ts reads and writes the files.
 */

/** One file's coverage: functions and lines, found and hit. */
export interface FileCoverage {
  readonly file: string;
  readonly functionsFound: number;
  readonly functionsHit: number;
  readonly linesFound: number;
  readonly linesHit: number;
}

/** A coverage in percent, 0 to 100, per metric. */
export interface Coverage {
  readonly functions: number;
  readonly lines: number;
}

/** The two metrics Bun measures, in a fixed order. */
const METRICS = ['functions', 'lines'] as const;

/** The files of an lcov report, in its order. */
export function parseLcov(text: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let file = '';
  let counts = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      file = line.slice(3);
      counts = new Map();
    } else if (line === 'end_of_record') {
      files.push({
        file,
        functionsFound: counts.get('FNF') ?? 0,
        functionsHit: counts.get('FNH') ?? 0,
        linesFound: counts.get('LF') ?? 0,
        linesHit: counts.get('LH') ?? 0,
      });
    } else {
      const [key = '', value = ''] = line.split(':');
      if (['FNF', 'FNH', 'LF', 'LH'].includes(key))
        counts.set(key, Number(value));
    }
  }
  return files;
}

/** A metric in percent; 100 with nothing to cover. */
const percent = (hit: number, found: number): number =>
  found === 0 ? 100 : (hit / found) * 100;

/** One file's coverage in percent. */
export const fileCoverage = (file: FileCoverage): Coverage => ({
  functions: percent(file.functionsHit, file.functionsFound),
  lines: percent(file.linesHit, file.linesFound),
});

/**
 * The coverage of several files as Bun computes its "All files" and checks
 * `coverageThreshold`: the mean of each file's percent, a file with nothing
 * to cover counting as 100. Summing hits and totals would give another
 * number, and a threshold Bun never reaches.
 */
export function totalCoverage(files: readonly FileCoverage[]): Coverage {
  if (files.length === 0) return { functions: 100, lines: 100 };
  const each = files.map(fileCoverage);
  const mean = (metric: keyof Coverage): number =>
    each.reduce((sum, coverage) => sum + coverage[metric], 0) / each.length;
  return { functions: mean('functions'), lines: mean('lines') };
}

/**
 * The thresholds in coverage-thresholds.json: percents of the total (the
 * mean per file, as Bun's "All files"), the way Jest's `global` works. Not
 * Bun's `coverageThreshold`: that one holds for every single file.
 */
export interface Thresholds {
  readonly functions: number;
  readonly lines: number;
}

/** The thresholds a JSON holds; an error saying the expected shape otherwise. */
export function readThresholds(json: string): Thresholds {
  const data: unknown = JSON.parse(json);
  const value = (key: string): unknown =>
    typeof data === 'object' && data !== null
      ? Reflect.get(data, key)
      : undefined;
  const functions = value('functions');
  const lines = value('lines');
  if (typeof functions !== 'number' || typeof lines !== 'number') {
    throw new Error(
      'coverage-thresholds.json precisa ser { "functions": 90, "lines": 90 }, em porcentagem.',
    );
  }
  return { functions, lines };
}

/** The thresholds as the JSON file holds them. */
export const thresholdsJson = (thresholds: Thresholds): string =>
  `${JSON.stringify({ functions: thresholds.functions, lines: thresholds.lines }, null, 2)}\n`;

/**
 * A percent rounded down to 0.01: never above what the run measured, or the
 * next run would fail with nothing worse.
 */
const asThreshold = (pct: number): number => Math.floor(pct * 100) / 100;

/** Whether a run fell below any threshold: it fails, and nothing is rewritten. */
export const belowThresholds = (
  actual: Coverage,
  current: Thresholds,
): boolean =>
  METRICS.some((metric) => asThreshold(actual[metric]) < current[metric]);

/** Each threshold raised to what the run reached; never lowered. */
export const ratchet = (actual: Coverage, current: Thresholds): Thresholds => ({
  functions: Math.max(current.functions, asThreshold(actual.functions)),
  lines: Math.max(current.lines, asThreshold(actual.lines)),
});

function status(pct: number): string {
  if (pct < 50) return '🔴';
  if (pct < 80) return '🟡';
  return '🟢';
}

/** The module a file belongs to: `src/<módulo>`, `rounds/web`… or its folder. */
export function moduleOf(file: string): string {
  const parts = file.split('/');
  if (parts.length > 2) return parts.slice(0, 2).join('/');
  return parts.length > 1 ? (parts[0] ?? '.') : '.';
}

const TABLE_HEADER = (label: string): string[] => [
  `Status|${label}|% Funcs|% Lines`,
  '--|--|--|--',
];

function row(label: string, coverage: Coverage, link?: string): string {
  const name = link === undefined ? `**${label}**` : `[${label}](${link})`;
  return [
    status(coverage.lines),
    name,
    coverage.functions.toFixed(2),
    coverage.lines.toFixed(2),
  ].join('|');
}

/** Two digits: `05`. */
const pad = (n: number): string => String(n).padStart(2, '0');

/** A percent as COVERAGE.md shows it: `93.56%`. */
const percentText = (value: number): string => `${value.toFixed(2)}%`;

/** `13/11/2026 09:05:00`. */
function timestamp(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The line that changes on every run: left out when comparing. */
export const GENERATED_LINE = /^Gerado automaticamente por .*$/m;

/**
 * COVERAGE.md: the total and each module on top, then each module's files
 * in a collapsible block, open when something in it is below 100 %.
 */
export function coverageMarkdown(
  files: readonly FileCoverage[],
  thresholds: Thresholds,
  generatedAt: Date = new Date(),
): string {
  const sorted = files.toSorted((a, b) => a.file.localeCompare(b.file));
  const modules = new Map<string, FileCoverage[]>();
  for (const file of sorted) {
    const name = moduleOf(file.file);
    modules.set(name, [...(modules.get(name) ?? []), file]);
  }
  const perModule = [...modules].map(([name, list]) => ({
    name,
    list,
    coverage: totalCoverage(list),
  }));

  return `${[
    '# Cobertura de testes',
    '',
    `Gerado automaticamente por \`bun run test:cov\` em ${timestamp(generatedAt)}: não edite à mão.`,
    '',
    `Limites (coverage-thresholds.json, só sobem): funções ${percentText(thresholds.functions)}, linhas ${percentText(thresholds.lines)}. O Bun mede funções e linhas; o total é a média por arquivo, como o "All files" dele.`,
    '',
    '## Resumo',
    '',
    ...TABLE_HEADER('Módulo'),
    row('Total', totalCoverage(sorted)),
    ...perModule.map(({ name, coverage }) => row(name, coverage, name)),
    '',
    '## Por módulo',
    '',
    ...perModule.flatMap(({ name, list, coverage }) => {
      const complete = list.every((file) =>
        METRICS.every((metric) => fileCoverage(file)[metric] >= 100),
      );
      const count =
        list.length === 1 ? '1 arquivo' : `${String(list.length)} arquivos`;
      return [
        complete ? '<details>' : '<details open>',
        `<summary>${status(coverage.lines)} <b>${name}</b>: ${coverage.lines.toFixed(2)}% das linhas, ${count}</summary>`,
        '',
        ...TABLE_HEADER('Arquivo'),
        ...list.map((file) =>
          row(
            name === '.' ? file.file : file.file.slice(name.length + 1),
            fileCoverage(file),
            file.file,
          ),
        ),
        '',
        '</details>',
        '',
      ];
    }),
  ]
    .join('\n')
    .trimEnd()}\n`;
}

/** The shields.io endpoint badge: the mean of the two metrics. */
export function coverageBadge(total: Coverage): {
  readonly schemaVersion: 1;
  readonly label: string;
  readonly message: string;
  readonly color: string;
} {
  const average = (total.functions + total.lines) / 2;
  return {
    schemaVersion: 1,
    label: 'coverage',
    message: `${average.toFixed(2)}%`,
    color: average < 50 ? 'red' : average < 80 ? 'yellow' : 'brightgreen',
  };
}
