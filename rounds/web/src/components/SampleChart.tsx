/**
 * A round's resource use over time: one line per series (CPU, GPU, RAM,
 * VRAM), all on a single 0–100% axis so they read against each other, X in
 * elapsed time. Memory is shown as a share of what the machine has, so it
 * sits on the same axis as the percentages. Drawn as plain SVG, like the XY
 * chart; no chart library. The mouse over the plot shows, at that instant,
 * each series' value and which agent was running.
 */

import { useRef, useState, type ReactNode } from 'react';

import type {
  ResourceSample,
  RoundResources,
  RoundStep,
} from '../../../../src/rounds/types';
import { CHART_WIDTH, SAMPLE_CHART_HEIGHT } from '../constants';
import { duration, megabytes, percent, title } from '../format';

const MARGIN = { top: 10, right: 12, bottom: 24, left: 34 } as const;
const PLOT_W = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = SAMPLE_CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_TICKS = [0, 25, 50, 75, 100] as const;
const X_TICKS = 5;

/** A value as a share of a total, 0–100; `null` when the total is unknown. */
const share = (used: number, total: number): number | null =>
  total === 0 ? null : (used / total) * 100;

/** Whether an instant falls inside a span. */
const within = (
  iso: string,
  span: { readonly startedAt: string; readonly endedAt: string },
): boolean => {
  const t = Date.parse(iso);
  return t >= Date.parse(span.startedAt) && t <= Date.parse(span.endedAt);
};

/** A short label for a tool call: its name and the first detail that reads. */
function toolLabel(tool: RoundStep['tools'][number]): string {
  const detail = tool.detail;
  const field = (key: string): string | undefined =>
    typeof detail[key] === 'string' ? detail[key] : undefined;
  const text =
    field('command') ??
    field('file_path') ??
    field('path') ??
    field('pattern') ??
    '';
  const short = text.length > 44 ? `${text.slice(0, 43)}…` : text;
  return short.length === 0 ? tool.name : `${tool.name}: ${short}`;
}

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
  /** What the tooltip shows for a sample; `null` leaves the row out. */
  readonly detail: (sample: ResourceSample) => string | null;
}

export function SampleChart({
  resources,
  steps,
}: {
  readonly resources: RoundResources;
  readonly steps: readonly RoundStep[];
}): ReactNode {
  const { samples, machine } = resources;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (samples.length < 2) {
    return (
      <p className="note">
        Sem amostras suficientes para um gráfico: a rodada foi mais curta que o
        intervalo de amostragem.
      </p>
    );
  }

  const t0 = Math.min(...samples.map((s) => Date.parse(s.ts)));
  const secondsOf = (iso: string): number => (Date.parse(iso) - t0) / 1000;
  const elapsedOf = (s: ResourceSample): number => secondsOf(s.ts);
  const maxT = Math.max(...samples.map(elapsedOf), 1);
  const vram = machine.gpu === null ? 0 : machine.gpu.memTotalMb;

  // One mark per tool call, where it started: what happened, on the timeline.
  const marks = steps.flatMap((step) =>
    step.tools.map((tool) => ({
      t: secondsOf(tool.span.startedAt),
      outcome: tool.outcome,
      label: `${title(step.actor)} · ${toolLabel(tool)}`,
    })),
  );

  const build = (value: (s: ResourceSample) => number | null): Point[] =>
    samples.map((s) => ({ t: elapsedOf(s), v: value(s) }));

  const series: Series[] = [
    {
      label: 'CPU',
      color: 'var(--guava)',
      points: build((s) => s.cpuPct),
      detail: (s) => percent(s.cpuPct),
    },
    {
      label: 'RAM',
      color: 'var(--leaf)',
      points: build((s) => share(s.memUsedMb, machine.memTotalMb)),
      detail: (s) =>
        `${percent(share(s.memUsedMb, machine.memTotalMb))} (${megabytes(s.memUsedMb)})`,
    },
  ];
  if (machine.gpu !== null) {
    series.push(
      {
        label: 'GPU',
        color: 'var(--violet)',
        points: build((s) => s.gpu?.utilPct ?? null),
        detail: (s) => (s.gpu === null ? null : percent(s.gpu.utilPct)),
      },
      {
        label: 'VRAM',
        color: 'var(--amber)',
        points: build((s) =>
          s.gpu === null ? null : share(s.gpu.memUsedMb, vram),
        ),
        detail: (s) =>
          s.gpu === null
            ? null
            : `${percent(share(s.gpu.memUsedMb, vram))} (${megabytes(s.gpu.memUsedMb)})`,
      },
    );
  }

  const x = (t: number): number => MARGIN.left + (t / maxT) * PLOT_W;
  const y = (v: number): number =>
    MARGIN.top + (1 - Math.min(100, Math.max(0, v)) / 100) * PLOT_H;

  /** The sample nearest the pointer, by elapsed time. */
  const nearest = (clientX: number): number => {
    const svg = svgRef.current;
    if (svg === null) return 0;
    const rect = svg.getBoundingClientRect();
    const units = ((clientX - rect.left) / rect.width) * CHART_WIDTH;
    const t = ((units - MARGIN.left) / PLOT_W) * maxT;
    let best = 0;
    let bestGap = Infinity;
    samples.forEach((sample, index) => {
      const gap = Math.abs(elapsedOf(sample) - t);
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    return best;
  };

  const current = hover === null ? undefined : samples[hover];
  // What was happening at the hovered instant: the agent, its turn, its tool.
  const activeStep =
    current === undefined
      ? undefined
      : steps.find((step) => within(current.ts, step.span));
  const activeTurn =
    current === undefined
      ? undefined
      : activeStep?.turns.find((turn) => within(current.ts, turn.span));
  const activeTool =
    current === undefined
      ? undefined
      : activeStep?.tools.find((tool) => within(current.ts, tool.span));

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
      <div className="sample-plot">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${String(CHART_WIDTH)} ${String(SAMPLE_CHART_HEIGHT)}`}
          role="img"
          aria-label="Uso de recursos ao longo da rodada, em porcentagem"
          onPointerMove={(event) => setHover(nearest(event.clientX))}
          onPointerLeave={() => setHover(null)}
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
          <g className="marks" aria-hidden="true">
            {marks
              .filter((mark) => mark.t >= 0 && mark.t <= maxT)
              .map((mark) => (
                <line
                  key={`${mark.label}-${String(mark.t)}`}
                  x1={x(mark.t)}
                  x2={x(mark.t)}
                  y1={MARGIN.top + PLOT_H - 5}
                  y2={MARGIN.top + PLOT_H}
                  style={{
                    stroke:
                      mark.outcome === 'error' ? 'var(--warn)' : 'var(--muted)',
                  }}
                />
              ))}
          </g>
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
          {current !== undefined && (
            <g className="cursor" aria-hidden="true">
              <line
                x1={x(elapsedOf(current))}
                x2={x(elapsedOf(current))}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_H}
              />
              {series.map((s) => {
                const point = s.points[hover ?? 0];
                return point === undefined || point.v === null ? null : (
                  <circle
                    key={s.label}
                    cx={x(point.t)}
                    cy={y(point.v)}
                    r={3}
                    style={{ fill: s.color }}
                  />
                );
              })}
            </g>
          )}
        </svg>
        {current !== undefined && (
          <div
            className="sample-tip"
            style={{
              left: `${String((x(elapsedOf(current)) / CHART_WIDTH) * 100)}%`,
            }}
          >
            <b>{duration(Math.round(elapsedOf(current)) * 1000)}</b>
            {activeStep !== undefined && (
              <span className="muted">
                {title(activeStep.actor)}
                {activeTurn === undefined
                  ? ''
                  : ` · turno ${String(activeTurn.index)}`}
              </span>
            )}
            {activeTool !== undefined && (
              <span className="happened">
                {toolLabel(activeTool)}{' '}
                {activeTool.outcome === 'error' ? '(erro)' : ''}
              </span>
            )}
            {series.map((s) => {
              const detail = s.detail(current);
              return detail === null ? null : (
                <span key={s.label}>
                  <span className="swatch" style={{ background: s.color }} />
                  {s.label}: {detail}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
