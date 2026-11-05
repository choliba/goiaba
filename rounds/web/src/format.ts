/** How numbers, times and money read on the pages, in Portuguese. */

import type { ActorSnapshot, TokenCounts } from '../../../src/rounds/types';

const integer = new Intl.NumberFormat('pt-BR');
const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** What a value that was not measured shows. */
export const NOT_MEASURED = '—';

/** `1 min 28 s`, `27 s`, `850 ms`. */
export function duration(ms: number | null): string {
  if (ms === null) return NOT_MEASURED;
  if (ms < 1000) return `${String(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes === 0
    ? `${String(seconds)} s`
    : `${String(minutes)} min ${String(seconds % 60)} s`;
}

/** `117.464`, or `—` when not measured. */
export const tokens = (value: number | null): string =>
  value === null ? NOT_MEASURED : integer.format(value);

/** `117 mil`: for tables. */
export function tokensShort(value: number | null): string {
  if (value === null) return NOT_MEASURED;
  if (value < 1000) return String(value);
  return `${integer.format(Math.round(value / 1000))} mil`;
}

export const cost = (value: number | null): string =>
  value === null ? NOT_MEASURED : usd.format(value);

export const when = (iso: string): string => date.format(new Date(iso));

export const count = (value: number, one: string, many: string): string =>
  `${String(value)} ${value === 1 ? one : many}`;

/**
 * `Claude · claude-opus-5-5`; with the CLI when the provider drives more
 * than one: `Ollama (codex) · qwen2.5-coder:latest`.
 */
export function providerOf(actor: ActorSnapshot): string {
  const { name, cli, model } = actor.provider;
  const provider = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return `${provider}${cli === null ? '' : ` (${cli})`} · ${model}`;
}

/** `analista` → `Analista`. */
export const title = (name: string): string =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export const sumTokens = (counts: TokenCounts): number | null =>
  counts.input === null && counts.output === null
    ? null
    : (counts.input ?? 0) + (counts.output ?? 0);

/** Mean and spread of the measured values; `undefined` when none was. */
export function spread(
  values: readonly (number | null)[],
): { mean: number; min: number; max: number } | undefined {
  const measured = values.filter((value) => value !== null);
  if (measured.length === 0) return undefined;
  const total = measured.reduce((a, b) => a + b, 0);
  return {
    mean: total / measured.length,
    min: Math.min(...measured),
    max: Math.max(...measured),
  };
}

/** The goal, or what the rounds that ran without one show. */
export const goalOf = (goal: string): string =>
  goal.trim().length === 0 ? 'sem objetivo declarado' : goal;
