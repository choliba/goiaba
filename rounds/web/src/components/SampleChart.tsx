/**
 * A round's resource use over time: one line per series (CPU, GPU, RAM,
 * VRAM), all on a single 0–100% axis so they read against each other, X in
 * elapsed time. Memory is shown as a share of what the machine has, so it
 * sits on the same axis as the percentages. Drawn as plain SVG, like the XY
 * chart; no chart library.
 */

import type { ReactNode } from 'react';

import type {
  ResourceSample,
  RoundResources,
} from '../../../../src/rounds/types';
import { CHART_WIDTH, SAMPLE_CHART_HEIGHT } from '../constants';
import { duration } from '../format';

const MARGIN = { top: 10, right: 12, bottom: 24, left: 34 } as const;
const PLOT_W = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = SAMPLE_CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_TICKS = [0, 25, 50, 75, 100] as const;
const X_TICKS = 5;

/** A point of a series: elapsed seconds and its value, 0–100 or a gap. */
interface Point {
  readonly t: number;
  readonly v: number | null;
}

interface Series {
  readonly label: string;
  /** A theme color variable. */
  readonly color: string;
  readonly points: readonly Point[];
}

export function SampleChart({
  resources,
}: {
  readonly resources: RoundResources;
}): ReactNode {
  const { samples, machine } = resources;
  if (samples.length < 2) {
    return (
      <p className="note">
        Sem amostras suficientes para um gráfico: a rodada foi mais curta que o
        intervalo de amostragem.
      </p>
    );
  }

  const t0 = Math.min(...samples.map((s) => Date.parse(s.ts)));
  const elapsedOf = (s: ResourceSample): number =>
    (Date.parse(s.ts) - t0) / 1000;
  const maxT = Math.max(...samples.map(elapsedOf), 1);
  const vram = machine.gpu === null ? 0 : machine.gpu.memTotalMb;

  const build = (value: (s: ResourceSample) => number | null): Point[] =>
    samples.map((s) => ({ t: elapsedOf(s), v: value(s) }));

  const series: Series[] = [
    { label: 'CPU', color: 'var(--guava)', points: build((s) => s.cpuPct) },
    {
      label: 'RAM',
      color: 'var(--leaf)',
      points: build((s) =>
        machine.memTotalMb === 0
          ? null
          : (s.memUsedMb / machine.memTotalMb) * 100,
      ),
    },
  ];
  if (machine.gpu !== null) {
    series.push(
      {
        label: 'GPU',
        color: 'var(--violet)',
        points: build((s) => s.gpu?.utilPct ?? null),
      },
      {
        label: 'VRAM',
        color: 'var(--amber)',
        points: build((s) =>
          vram === 0 || s.gpu === null ? null : (s.gpu.memUsedMb / vram) * 100,
        ),
      },
    );
  }

  const x = (t: number): number => MARGIN.left + (t / maxT) * PLOT_W;
  const y = (v: number): number =>
    MARGIN.top + (1 - Math.min(100, Math.max(0, v)) / 100) * PLOT_H;

  return (
    <div className="sample-chart xy-chart">
      <ul className="legend">
        {series.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(SAMPLE_CHART_HEIGHT)}`}
        role="img"
        aria-label="Uso de recursos ao longo da rodada, em porcentagem"
      >
        {Y_TICKS.map((v) => (
          <g key={`y${String(v)}`} className="tick">
            <line
              x1={MARGIN.left}
              x2={CHART_WIDTH - MARGIN.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text
              x={MARGIN.left - 6}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {String(v)}
            </text>
          </g>
        ))}
        {Array.from(
          { length: X_TICKS + 1 },
          (_, i) => (maxT / X_TICKS) * i,
        ).map((t) => (
          <text
            key={`x${String(t)}`}
            className="tick"
            x={x(t)}
            y={SAMPLE_CHART_HEIGHT - 8}
            textAnchor="middle"
          >
            {duration(Math.round(t) * 1000)}
          </text>
        ))}
        <line
          className="axis"
          x1={MARGIN.left}
          x2={MARGIN.left}
          y1={MARGIN.top}
          y2={MARGIN.top + PLOT_H}
        />
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={1.75}
            points={s.points
              .map((p) =>
                p.v === null ? '' : `${String(x(p.t))},${String(y(p.v))}`,
              )
              .filter((point) => point.length > 0)
              .join(' ')}
          />
        ))}
      </svg>
    </div>
  );
}
