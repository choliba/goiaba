/**
 * An XY chart of the agents a page shows (the index's filter, a test's
 * rounds): each point is one agent in one round, X on the horizontal axis
 * and Y on the vertical, both chosen from the same measures the tables
 * show. A color per provider; a point opens a card with links to its test
 * and round. What was not measured on either axis is left out and counted,
 * never drawn as 0.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { ActorSnapshot, RoundRecord } from '../../../../src/rounds/types';
import {
  CHART_HEIGHT,
  CHART_TICKS,
  CHART_WIDTH,
  HOVER_CLOSE_MS,
} from '../constants';
import type { Round, Test } from '../data';
import {
  cost,
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
  /** Scores always span 0–5, whatever the points. */
  readonly domain?: readonly [number, number];
}

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
    domain: [0, 5],
  },
  eficacia: {
    label: 'Eficácia',
    value: (round, name) =>
      round.score.actors[name]?.effectiveness.score ?? null,
    show: grade,
    domain: [0, 5],
  },
  eficiencia: {
    label: 'Eficiência',
    value: (round, name) => round.score.actors[name]?.efficiency.score ?? null,
    show: grade,
    domain: [0, 5],
  },
  tempo: {
    label: 'Tempo gasto',
    value: measure((r, name) => r.timing.actors[name]?.durationMs ?? undefined),
    show: duration,
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
  },
  ferramentas: {
    label: 'Ferramentas',
    value: measure((r, name) => r.measures[name]?.tools),
    show: decimal,
  },
  perguntas: {
    label: 'Perguntas',
    value: measure((r, name) => r.measures[name]?.questions),
    show: decimal,
  },
  arquivos: {
    label: 'Arquivos alterados',
    value: measure((r, name) => r.measures[name]?.changedFiles),
    show: decimal,
  },
} satisfies Record<string, Metric>;

type MetricKey = keyof typeof METRICS;
const METRIC_KEYS = Object.keys(METRICS).filter(
  (key): key is MetricKey => key in METRICS,
);
const metricOf = (key: MetricKey): Metric => METRICS[key];

/** One color per provider, in order of appearance: the theme's actor hues. */
const COLORS = [
  'var(--guava)',
  'var(--violet)',
  'var(--leaf)',
  'var(--amber)',
  'var(--sky)',
];

/**
 * The margin a cropped axis leaves past its extreme values, as a share of
 * their range: 10% keeps the outermost points off the frame.
 */
const CROP_MARGIN = 0.1;

/** Room for the axes' labels, inside the drawing area. */
const MARGIN = { top: 16, right: 20, bottom: 44, left: 72 };

interface Point {
  readonly round: Round;
  readonly name: string;
  readonly provider: string;
  readonly x: number;
  readonly y: number;
}

/** Round numbers across `[min, max]`, about `CHART_TICKS` of them. */
function ticks(min: number, max: number): number[] {
  const raw = (max - min) / CHART_TICKS;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
    values.push(v);
  }
  return values;
}

/**
 * The axis span. Cropped (the default): from the lowest to the highest
 * value, with a margin, so close scenarios (notes 3,8 and 4,3) spread out
 * instead of sharing a sliver of 0–5. Full: a score's whole 0–5, and
 * counts and amounts from 0. Dates are always cropped: 0 is 1970.
 */
function domainOf(
  metric: Metric,
  values: readonly number[],
  crop: boolean,
): [number, number] {
  if (!crop && metric.domain !== undefined) return [...metric.domain];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!crop && metric !== METRICS.data && min >= 0) min = 0;
  const pad =
    min === max
      ? max === 0
        ? 1
        : Math.abs(max) * CROP_MARGIN
      : crop
        ? (max - min) * CROP_MARGIN
        : 0;
  min -= pad;
  max += pad;
  // A cropped score still stays inside 0–5.
  if (metric.domain !== undefined) {
    min = Math.max(min, metric.domain[0]);
    max = Math.min(max, metric.domain[1]);
  }
  return [min, max];
}

function AxisSelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: MetricKey;
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
          <option key={key} value={key}>
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
  const [crop, setCrop] = useState(true);
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
  const providers = [...new Set(points.map((p) => p.provider))];
  const colorOf = (provider: string): string =>
    COLORS[providers.indexOf(provider) % COLORS.length] ?? COLORS[0] ?? '';

  const plotW = CHART_WIDTH - MARGIN.left - MARGIN.right;
  const plotH = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  const [x0, x1] = domainOf(
    xMetric,
    points.map((p) => p.x),
    crop,
  );
  const [y0, y1] = domainOf(
    yMetric,
    points.map((p) => p.y),
    crop,
  );
  const sx = (v: number): number =>
    MARGIN.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number): number =>
    MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  const keyOf = (p: Point): string => `${p.round.record.id}-${p.name}`;
  const shown = selected ?? hovered;
  const open = points.find((p) => keyOf(p) === shown);

  return (
    <div className="xy-chart">
      <div className="filters">
        <AxisSelect label="Eixo Y (vertical)" value={yKey} onChange={setYKey} />
        <AxisSelect
          label="Eixo X (horizontal)"
          value={xKey}
          onChange={setXKey}
        />
        <label>
          <span>Escala</span>
          <select
            value={crop ? 'recorte' : 'completa'}
            onChange={(event) => setCrop(event.target.value === 'recorte')}
          >
            <option value="recorte">Recorte dos dados</option>
            <option value="completa">Completa (nota de 0 a 5)</option>
          </select>
        </label>
      </div>
      <p className="note" aria-live="polite">
        {points.length === 0
          ? 'Nenhum agente com as duas medidas.'
          : `${String(points.length)} ponto(s): cada um é um agente em uma rodada`}
        {missing > 0 &&
          ` · ${String(missing)} sem uma das medidas, fora do gráfico`}
      </p>
      {points.length > 0 && (
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
              {ticks(y0, y1).map((v) => (
                <g key={`y${String(v)}`} className="tick">
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotW}
                    y1={sy(v)}
                    y2={sy(v)}
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={sy(v)}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {yMetric.show(v)}
                  </text>
                </g>
              ))}
              {ticks(x0, x1).map((v) => (
                <g key={`x${String(v)}`} className="tick">
                  <line
                    x1={sx(v)}
                    x2={sx(v)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + plotH}
                  />
                  <text
                    x={sx(v)}
                    y={MARGIN.top + plotH + 18}
                    textAnchor="middle"
                  >
                    {xMetric.show(v)}
                  </text>
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
                    fill={colorOf(p.provider)}
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
          <ul className="legend">
            {providers.map((provider) => (
              <li key={provider}>
                <span
                  className="swatch"
                  style={{ background: colorOf(provider) }}
                />
                {provider}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
