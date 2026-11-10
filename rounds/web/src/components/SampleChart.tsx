/**
 * A round's resource use over time: one line per series (CPU, GPU, RAM,
 * VRAM), all on a single 0–100% axis so they read against each other, X in
 * elapsed time. Memory is shown as a share of what the machine has, so it
 * sits on the same axis as the percentages. Drawn as plain SVG, like the XY
 * chart; no chart library. A crosshair finds specific points: the vertical
 * line follows the mouse and shows, at that instant, each series' value and
 * which agent was running; the horizontal one reads the value under the
 * mouse. A click pins both where they are, and the mouse no longer moves
 * them; the arrows move the instant sample by sample, Esc (or a click
 * outside the chart) lets both go.
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

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
  /** The value (0–100) under the pointer, for the horizontal line. */
  const [level, setLevel] = useState<number | null>(null);
  /** The instant kept by a click (or the arrows), until Esc or another click. */
  const [pinned, setPinned] = useState<number | null>(null);
  /** The value kept with it: the horizontal line where the click was. */
  const [pinnedLevel, setPinnedLevel] = useState<number | null>(null);

  // A click anywhere outside the chart lets the pinned lines go, like Esc.
  useEffect(() => {
    if (pinned === null) return undefined;
    const release = (event: PointerEvent): void => {
      const svg = svgRef.current;
      if (
        svg !== null &&
        event.target instanceof Node &&
        svg.contains(event.target)
      ) {
        return;
      }
      setPinned(null);
      setPinnedLevel(null);
    };
    document.addEventListener('pointerdown', release);
    return () => document.removeEventListener('pointerdown', release);
  }, [pinned]);

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

  /** The value under the pointer, 0–100; `null` outside the plot. */
  const levelAt = (clientY: number): number | null => {
    const svg = svgRef.current;
    if (svg === null) return null;
    const rect = svg.getBoundingClientRect();
    const units = ((clientY - rect.top) / rect.height) * SAMPLE_CHART_HEIGHT;
    const v = (1 - (units - MARGIN.top) / PLOT_H) * 100;
    return v < 0 || v > 100 ? null : v;
  };

  const last = samples.length - 1;
  const onKey = (event: KeyboardEvent<SVGSVGElement>): void => {
    const from = pinned ?? hover ?? 0;
    const to =
      event.key === 'ArrowRight'
        ? Math.min(last, from + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, from - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (to !== undefined) {
      event.preventDefault();
      setPinned(to);
    } else if (event.key === 'Escape') {
      setPinned(null);
      setPinnedLevel(null);
    }
  };

  /** What the cursor shows: the pinned instant, or the one under the mouse. */
  const shown = pinned ?? hover;
  /** The horizontal line: where it was pinned, or under the mouse. */
  const shownLevel = pinned === null ? level : pinnedLevel;
  const current = shown === null ? undefined : samples[shown];
  /**
   * The label of the instant on the time axis: its text, and where its box
   * starts, kept inside the chart at both ends.
   */
  const timeLabel = (() => {
    const text =
      current === undefined
        ? ''
        : duration(Math.round(elapsedOf(current)) * 1000);
    // About the width of the 11-unit monospace digits, plus padding.
    const width = text.length * 6.7 + 10;
    const center = current === undefined ? 0 : x(elapsedOf(current));
    const left = Math.min(CHART_WIDTH - width, Math.max(0, center - width / 2));
    return { text, width, left };
  })();
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
  // What it was doing: a tool, when one ran; otherwise, inside a turn, the
  // model was producing the answer (what the GPU spends on).
  const activity =
    activeTool !== undefined
      ? `${toolLabel(activeTool)}${activeTool.outcome === 'error' ? ' (erro)' : ''}`
      : activeTurn !== undefined
        ? 'o modelo gerando a resposta'
        : undefined;

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
          tabIndex={0}
          onPointerMove={(event) => {
            setHover(nearest(event.clientX));
            setLevel(levelAt(event.clientY));
          }}
          onPointerLeave={() => {
            setHover(null);
            setLevel(null);
          }}
          onClick={(event) => {
            // Pins both lines where the click was; Esc lets them go.
            setPinned(nearest(event.clientX));
            setPinnedLevel(levelAt(event.clientY));
          }}
          onKeyDown={onKey}
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
          {shownLevel !== null && (
            <g className="cursor level" aria-hidden="true">
              <line
                x1={MARGIN.left}
                x2={CHART_WIDTH - MARGIN.right}
                y1={y(shownLevel)}
                y2={y(shownLevel)}
              />
              <rect
                x={0}
                y={y(shownLevel) - 8}
                width={MARGIN.left - 2}
                height={16}
                rx={3}
              />
              <text
                x={MARGIN.left - 6}
                y={y(shownLevel)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {`${String(Math.round(shownLevel))}%`}
              </text>
            </g>
          )}
          {current !== undefined && (
            <g
              className={pinned === null ? 'cursor' : 'cursor pinned'}
              aria-hidden="true"
            >
              <line
                x1={x(elapsedOf(current))}
                x2={x(elapsedOf(current))}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_H}
              />
              {/* The instant, on the time axis: over its tick labels. */}
              <g className="time">
                <rect
                  x={timeLabel.left}
                  y={SAMPLE_CHART_HEIGHT - 17}
                  width={timeLabel.width}
                  height={16}
                  rx={3}
                />
                <text
                  x={timeLabel.left + timeLabel.width / 2}
                  y={SAMPLE_CHART_HEIGHT - 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {timeLabel.text}
                </text>
              </g>
              {series.map((s) => {
                const point = s.points[shown ?? 0];
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
            <b>
              {duration(Math.round(elapsedOf(current)) * 1000)}
              {pinned !== null && <span className="muted"> · fixado</span>}
            </b>
            {activeStep !== undefined && (
              <span className="muted">
                {title(activeStep.actor)}
                {activeTurn === undefined
                  ? ''
                  : ` · turno ${String(activeTurn.index)}`}
              </span>
            )}
            {activity !== undefined && (
              <span className="happened">{activity}</span>
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
      <p className="note chart-hint">
        Clique para fixar as linhas; as setas andam amostra por amostra, Esc ou
        um clique fora do gráfico solta.
      </p>
    </div>
  );
}
