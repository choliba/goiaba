/**
 * An XY chart of the agents a page shows (the index's filter, a test's
 * rounds): each point is one agent in one round, X on the horizontal axis
 * and Y on the vertical, both chosen from the same measures the tables
 * show. A color per provider; a point opens a card with links to its test
 * and round. What was not measured on either axis is left out and counted,
 * never drawn as 0.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { ActorSnapshot, RoundRecord } from '../../../../src/rounds/types';
import {
  CHART_HEIGHT,
  CHART_TICKS,
  CHART_WIDTH,
  GRID_DENSITY,
  GRID_LABEL_GAP,
  HOVER_CLOSE_MS,
} from '../constants';
import type { Round, Test } from '../data';
import {
  cost,
  count,
  duration,
  providerOf,
  sumTokens,
  title,
  tokensShort,
} from '../format';
import { roundHref, testHref } from '../route';
import { decimal } from '../summary';
import { grade } from './Scores';

interface Metric {
  readonly label: string;
  /** `null` when not measured. */
  readonly value: (round: Round, name: string) => number | null;
  readonly show: (value: number) => string;
  /**
   * A grid line's label, when it needs more precision than `show` (a score
   * shows 3,5, but a line can be at 3,25); `show` by default.
   */
  readonly tick?: (value: number) => string;
  /**
   * The unit an axis rounds its end in (60 000 ms: whole minutes), so its
   * steps read round (10 min, 5 min, 1 min) and not 3 min 20 s.
   */
  readonly unit?: number;
  /** Scores always span 0–5, whatever the points. */
  readonly domain?: readonly [number, number];
}

/** `3,25`: a grid line's value, up to two decimals. */
const fine = (value: number): string =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** A minute, in milliseconds: time axes end on whole minutes. */
const MINUTE_MS = 60 * 1000;

const measure =
  (pick: (record: RoundRecord, name: string) => number | undefined) =>
  (round: Round, name: string): number | null =>
    pick(round.record, name) ?? null;

const shortDate = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const METRICS = {
  data: {
    label: 'Data da rodada',
    value: (round) => Date.parse(round.record.timing.startedAt),
    show: (value) => shortDate.format(new Date(value)),
  },
  nota: {
    label: 'Nota',
    value: (round, name) => round.score.actors[name]?.final ?? null,
    show: grade,
    tick: fine,
    domain: [0, 5],
  },
  eficacia: {
    label: 'Eficácia',
    value: (round, name) =>
      round.score.actors[name]?.effectiveness.score ?? null,
    show: grade,
    tick: fine,
    domain: [0, 5],
  },
  eficiencia: {
    label: 'Eficiência',
    value: (round, name) => round.score.actors[name]?.efficiency.score ?? null,
    show: grade,
    tick: fine,
    domain: [0, 5],
  },
  tempo: {
    label: 'Tempo gasto',
    value: measure((r, name) => r.timing.actors[name]?.durationMs ?? undefined),
    show: duration,
    // Grid lines fall on whole minutes: `10 min`, not `10 min 0 s`.
    tick: (ms) =>
      ms === 0
        ? '0'
        : ms % MINUTE_MS === 0
          ? `${String(ms / MINUTE_MS)} min`
          : duration(ms),
    unit: MINUTE_MS,
  },
  tokens: {
    label: 'Tokens',
    value: (round, name) => {
      const counts = round.record.totals.actors[name]?.tokens;
      return counts === undefined ? null : sumTokens(counts);
    },
    show: tokensShort,
  },
  custo: {
    label: 'Custo',
    value: measure((r, name) => r.totals.actors[name]?.costUsd ?? undefined),
    show: cost,
  },
  turnos: {
    label: 'Turnos',
    value: measure((r, name) => r.measures[name]?.turns),
    show: decimal,
    tick: fine,
  },
  ferramentas: {
    label: 'Ferramentas',
    value: measure((r, name) => r.measures[name]?.tools),
    show: decimal,
    tick: fine,
  },
  perguntas: {
    label: 'Perguntas',
    value: measure((r, name) => r.measures[name]?.questions),
    show: decimal,
    tick: fine,
  },
  arquivos: {
    label: 'Arquivos alterados',
    value: measure((r, name) => r.measures[name]?.changedFiles),
    show: decimal,
    tick: fine,
  },
} satisfies Record<string, Metric>;

type MetricKey = keyof typeof METRICS;
const METRIC_KEYS = Object.keys(METRICS).filter(
  (key): key is MetricKey => key in METRICS,
);
const metricOf = (key: MetricKey): Metric => METRICS[key];

/** One color per group, in order of appearance: the theme's hues. */
const COLORS = [
  'var(--guava)',
  'var(--violet)',
  'var(--leaf)',
  'var(--amber)',
  'var(--sky)',
  'var(--warn)',
  'var(--you)',
];

/**
 * The margin an axis leaves past its highest value (and a date past both
 * ends), as a share of the range: 10% keeps the outermost points off the
 * frame.
 */
const CROP_MARGIN = 0.1;

/** Room for the axes' labels, inside the drawing area. */
const MARGIN = { top: 16, right: 44, bottom: 44, left: 72 };

interface Point {
  readonly round: Round;
  readonly name: string;
  readonly provider: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The round number an axis ends at: the first of 1, 2, 2,5, 5 or 10 times a
 * power of ten that reaches `value`. Divided in 5, 10 or 50 equal parts, it
 * gives round steps too (0,5 → 0,1, 0,05 and 0,01).
 */
function roundEnd(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((end) => end >= value) ??
    value
  );
}

/** `0,1`: the distance between two lines of an axis. */
function stepText(metric: Metric, lines: readonly number[]): string {
  const [first, second] = lines;
  if (first === undefined || second === undefined) return '';
  const step = second - first;
  // A date's step is a span of time, not a date.
  const show =
    metric === METRICS.data ? duration : (metric.tick ?? metric.show);
  return show(step);
}

/** A day, in milliseconds: an empty date axis spans one. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The axis span, fixed: a score's whole 0–5; counts and amounts from 0 to a
 * round number past the highest point (with a margin), so that the same
 * divisions as the other axis fall on round values. Dates go from the
 * first to the last point: their 0 is 1970. With no value at all, an empty
 * ruler: 0 to 1, or the last day for a date.
 */
function domainOf(
  metric: Metric,
  values: readonly number[],
): readonly [number, number] {
  if (metric.domain !== undefined) return metric.domain;
  if (values.length === 0) {
    const now = Date.now();
    return metric === METRICS.data ? [now - DAY_MS, now] : [0, 1];
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (metric === METRICS.data) {
    const pad = low === high ? DAY_MS / 2 : (high - low) * CROP_MARGIN;
    return [low - pad, high + pad];
  }
  const reach = high * (1 + CROP_MARGIN);
  // In its unit only when it reaches one: 40 s stays in seconds.
  const unit =
    metric.unit !== undefined && reach >= metric.unit ? metric.unit : 1;
  return [Math.min(0, low), roundEnd(reach / unit) * unit];
}

/** A value as an integer key: 0,1 + 0,2 and 0,3 must meet. */
const sameValue = (value: number): number => Math.round(value * 1e6);

/** Vertical values stack: a line of text apart, whatever they say. */
const yGap = (): number => GRID_LABEL_GAP.y;

/** How many equal parts an axis is cut in at density `level`. */
const parts = (level: number): number =>
  CHART_TICKS * (GRID_DENSITY[level] ?? 1);

/**
 * The grid of one axis: the span cut in `CHART_TICKS` × density equal
 * parts, the same count on both axes, and a value written on a line only
 * where values have room (`minGap` apart): the coarsest lines always, the
 * finer ones as long as they fit. The counts nest (5, 10, 50), so a line
 * written at one density is a line at the next.
 */
function grid(
  span: readonly [number, number],
  level: number,
  length: number,
  /** The room the values of these lines need, from one to the next. */
  minGap: (values: readonly number[]) => number,
): { readonly lines: number[]; readonly labeled: Set<number> } {
  const [min, max] = span;
  const at = (l: number): number[] =>
    Array.from(
      { length: parts(l) + 1 },
      (_, i) => min + ((max - min) * i) / parts(l),
    );
  let labelLevel = 0;
  for (let l = level; l > 0; l -= 1) {
    if (length / parts(l) >= minGap(at(l))) {
      labelLevel = l;
      break;
    }
  }
  const lines = at(level);
  const wanted = new Set(at(labelLevel).map(sameValue));
  return {
    lines,
    labeled: new Set(lines.filter((v) => wanted.has(sameValue(v)))),
  };
}

function AxisSelect({
  label,
  value,
  taken,
  onChange,
}: {
  readonly label: string;
  readonly value: MetricKey;
  /**
   * The other axis's measure: not offered, since the same one on both axes
   * only puts every point on the diagonal.
   */
  readonly taken: MetricKey;
  readonly onChange: (value: MetricKey) => void;
}): ReactNode {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          const key = METRIC_KEYS.find((k) => k === event.target.value);
          if (key !== undefined) onChange(key);
        }}
      >
        {METRIC_KEYS.map((key) => (
          <option key={key} value={key} disabled={key === taken}>
            {metricOf(key).label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The card of a point, over the chart (on hover, or kept open by a click):
 * what it is, its two values, and links to its test and its round. `x` and
 * `y` are the point's place, from 0 to 1 of the chart; the card opens
 * toward the side with room.
 */
function PointCard({
  point,
  x,
  y,
  lines,
  onClose,
  onHover,
}: {
  readonly point: Point;
  readonly x: number;
  readonly y: number;
  readonly lines: readonly string[];
  readonly onClose: () => void;
  /** The mouse entered (true) or left (false) the card. */
  readonly onHover: (inside: boolean) => void;
}): ReactNode {
  const { round } = point;
  const shiftX = x < 0.25 ? '0%' : x > 0.75 ? '-100%' : '-50%';
  const shiftY = y < 0.4 ? '14px' : 'calc(-100% - 14px)';
  return (
    <div
      className="point-card"
      role="dialog"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      aria-label={`Rodada ${String(round.index)} de ${round.test.title}`}
      style={{
        left: `${String(x * 100)}%`,
        top: `${String(y * 100)}%`,
        transform: `translate(${shiftX}, ${shiftY})`,
      }}
    >
      <button
        type="button"
        className="close"
        aria-label="Fechar"
        onClick={onClose}
      >
        ×
      </button>
      {/* What has a page of its own is its link; the rest is text. */}
      <strong>
        <a href={testHref(round.test.key)}>{round.test.title}</a> ·{' '}
        <a href={roundHref(round.record.id)}>Rodada {round.index}</a>
      </strong>
      <span className="muted">
        {title(point.name)} · {point.provider}
      </span>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}

/**
 * Why the chart has no point, saying which measure is missing: `Não há
 * pontos para Nota × Custo: nenhum agente tem registro de custo.`
 */
function emptyText(
  candidates: readonly {
    readonly x: number | null;
    readonly y: number | null;
  }[],
  x: Metric,
  y: Metric,
): string {
  const pair = `Não há pontos para ${y.label} × ${x.label}`;
  if (candidates.length === 0) return `${pair}: nenhum agente nesta seleção.`;
  const noX = candidates.every((c) => c.x === null);
  const noY = candidates.every((c) => c.y === null);
  const missing =
    noX && noY
      ? `${y.label.toLowerCase()} nem de ${x.label.toLowerCase()}`
      : noX
        ? x.label.toLowerCase()
        : noY
          ? y.label.toLowerCase()
          : '';
  return missing === ''
    ? `${pair}: nenhum agente tem as duas medidas na mesma rodada.`
    : `${pair}: nenhum agente tem registro de ${missing}.`;
}

export function XyChart({
  tests,
  matches = () => true,
}: {
  readonly tests: readonly Test[];
  /** A page's filter: whether this agent counts; without one, every agent. */
  readonly matches?: (name: string, actor: ActorSnapshot) => boolean;
}): ReactNode {
  const [xKey, setXKey] = useState<MetricKey>('data');
  const [yKey, setYKey] = useState<MetricKey>('nota');
  /** How many lines the grid has, on both axes: an index into `GRID_DENSITY`. */
  const [level, setLevel] = useState(0);
  /** The options' group, one per chart: radios share it by name. */
  const gridName = useId();
  /** The point whose card is open: `<round id>-<agent>`. */
  const [selected, setSelected] = useState<string | null>(null);
  /** The point under the mouse: its card shows while no other is clicked. */
  const [hovered, setHovered] = useState<string | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stay = (): void => clearTimeout(leaving.current);
  // Not at once: the mouse crosses the gap between the point and its card.
  const leave = (): void => {
    stay();
    leaving.current = setTimeout(() => setHovered(null), HOVER_CLOSE_MS);
  };
  useEffect(() => stay, []);
  const xMetric = metricOf(xKey);
  const yMetric = metricOf(yKey);

  const candidates = tests.flatMap((test) =>
    test.rounds.flatMap((round) =>
      Object.entries(round.record.actors)
        .filter(([name, actor]) => matches(name, actor))
        .map(([name, actor]) => ({
          round,
          name,
          provider: providerOf(actor),
          x: xMetric.value(round, name),
          y: yMetric.value(round, name),
        })),
    ),
  );
  const points: Point[] = candidates.flatMap(({ x, y, ...rest }) =>
    x === null || y === null ? [] : [{ ...rest, x, y }],
  );
  const missing = candidates.length - points.length;
  const groupOf = (p: Point): string => p.provider;
  const groups = [...new Set(points.map(groupOf))];
  const colorOf = (group: string): string =>
    COLORS[groups.indexOf(group) % COLORS.length] ?? COLORS[0] ?? '';
  const rounds = new Set(points.map((p) => p.round.record.id)).size;
  const testsShown = new Set(points.map((p) => p.round.test.key)).size;

  const plotW = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const plotH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  // Without points, each axis still spans the values it has alone: an
  // empty chart keeps the ruler of the measure that was taken.
  const valuesOf = (pick: (c: (typeof candidates)[number]) => number | null) =>
    (points.length > 0 ? points : candidates)
      .map(pick)
      .filter((v) => v !== null);
  const xSpan = domainOf(
    xMetric,
    valuesOf((c) => c.x),
  );
  const ySpan = domainOf(
    yMetric,
    valuesOf((c) => c.y),
  );
  const [x0, x1] = xSpan;
  const [y0, y1] = ySpan;
  const sx = (v: number): number =>
    MARGIN.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number): number =>
    MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  // Horizontal values sit side by side: as wide as the widest, plus a gap.
  const xGap = (values: readonly number[]): number =>
    Math.max(...values.map((v) => (xMetric.tick ?? xMetric.show)(v).length)) *
      GRID_LABEL_GAP.char +
    GRID_LABEL_GAP.x;
  const yGrid = grid(ySpan, level, plotH, yGap);
  const xGrid = grid(xSpan, level, plotW, xGap);
  const keyOf = (p: Point): string => `${p.round.record.id}-${p.name}`;
  const shown = selected ?? hovered;
  const open = points.find((p) => keyOf(p) === shown);

  return (
    <div className="xy-chart">
      <div className="filters">
        <AxisSelect
          label="Eixo Y (vertical)"
          value={yKey}
          taken={xKey}
          onChange={setYKey}
        />
        <AxisSelect
          label="Eixo X (horizontal)"
          value={xKey}
          taken={yKey}
          onChange={setXKey}
        />
        {/* Each option says its step on the vertical axis: 1, 0,5 or 0,1 for a score. */}
        <fieldset className="grid-steps">
          <legend>Linhas da grade a cada</legend>
          {GRID_DENSITY.map((_, option) => (
            <label key={option}>
              <input
                type="radio"
                name={gridName}
                checked={option === level}
                onChange={() => setLevel(option)}
              />
              <span>
                {stepText(yMetric, grid(ySpan, option, plotH, yGap).lines)}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <p className="note" aria-live="polite">
        {points.length === 0
          ? emptyText(candidates, xMetric, yMetric)
          : `${count(points.length, 'ponto', 'pontos')} de ${count(rounds, 'rodada', 'rodadas')} em ${count(testsShown, 'teste', 'testes')}: um ponto por agente em cada rodada`}
        {points.length > 0 &&
          missing > 0 &&
          ` · ${String(missing)} sem ${yMetric.label.toLowerCase()} ou ${xMetric.label.toLowerCase()}, fora do gráfico`}
      </p>
      {
        <>
          <div
            className="xy-plot"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSelected(null);
            }}
          >
            <svg
              onClick={() => setSelected(null)}
              viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
              role="img"
              aria-label={`${yMetric.label} por ${xMetric.label}`}
            >
              {yGrid.lines.map((v) => (
                <g key={`y${String(v)}`} className="tick">
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotW}
                    y1={sy(v)}
                    y2={sy(v)}
                  />
                  {yGrid.labeled.has(v) && (
                    <text
                      x={MARGIN.left - 8}
                      y={sy(v)}
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      {(yMetric.tick ?? yMetric.show)(v)}
                    </text>
                  )}
                </g>
              ))}
              {xGrid.lines.map((v) => (
                <g key={`x${String(v)}`} className="tick">
                  <line
                    x1={sx(v)}
                    x2={sx(v)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + plotH}
                  />
                  {xGrid.labeled.has(v) && (
                    <text
                      x={sx(v)}
                      y={MARGIN.top + plotH + 18}
                      // The last value ends at the frame instead of past it.
                      textAnchor="middle"
                    >
                      {(xMetric.tick ?? xMetric.show)(v)}
                    </text>
                  )}
                </g>
              ))}
              <line
                className="axis"
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={MARGIN.top + plotH}
                y2={MARGIN.top + plotH}
              />
              <line
                className="axis"
                x1={MARGIN.left}
                x2={MARGIN.left}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
              />
              <text
                className="axis-label"
                x={MARGIN.left + plotW / 2}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
              >
                {xMetric.label}
              </text>
              <text
                className="axis-label"
                transform={`translate(14 ${String(MARGIN.top + plotH / 2)}) rotate(-90)`}
                textAnchor="middle"
              >
                {yMetric.label}
              </text>
              {points.map((p) => (
                <g
                  key={keyOf(p)}
                  className={keyOf(p) === shown ? 'point open' : 'point'}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.round.test.title}, rodada ${String(p.round.index)}, ${title(p.name)}: ${xMetric.label} ${xMetric.show(p.x)}, ${yMetric.label} ${yMetric.show(p.y)}`}
                  onMouseEnter={() => {
                    stay();
                    setHovered(keyOf(p));
                  }}
                  onMouseLeave={leave}
                  onClick={(event) => {
                    // The chart's own click closes the card.
                    event.stopPropagation();
                    setSelected(keyOf(p) === selected ? null : keyOf(p));
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setSelected(keyOf(p) === selected ? null : keyOf(p));
                  }}
                >
                  <circle
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={6}
                    fill={colorOf(groupOf(p))}
                  />
                </g>
              ))}
            </svg>
            {open !== undefined && (
              <PointCard
                point={open}
                x={sx(open.x) / CHART_WIDTH}
                y={sy(open.y) / CHART_HEIGHT}
                lines={[
                  `${xMetric.label}: ${xMetric.show(open.x)}`,
                  `${yMetric.label}: ${yMetric.show(open.y)}`,
                ]}
                onClose={() => {
                  setSelected(null);
                  setHovered(null);
                }}
                onHover={(inside) => (inside ? stay() : leave())}
              />
            )}
          </div>
          {groups.length > 0 && (
            <ul className="legend">
              {groups.map((group) => (
                <li key={group}>
                  <span
                    className="swatch"
                    style={{ background: colorOf(group) }}
                  />
                  {group}
                </li>
              ))}
            </ul>
          )}
        </>
      }
    </div>
  );
}
