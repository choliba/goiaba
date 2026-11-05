/**
 * The rubric: how a round is scored, from what its record holds. Pure and
 * without other modules' runtime code, so the pages score with it too.
 *
 * Two scores per agent, 0 to 5, never averaged into one (rounds/README.md):
 * - effectiveness (what): did it reach the goal, whatever it cost;
 * - efficiency (how): what it spent and wasted to get there, scaled by the
 *   share of the goal it reached (most result for least resources).
 * An eliminatory rule broken makes both 0. A criterion with nothing to
 * measure is `null` (not evaluated), never 0.
 *
 * Changing a criterion changes `RUBRIC_VERSION`: every round, old or new,
 * is scored by the same rubric, and the pages say which.
 */

import { RUBRIC } from './constants';
import type { RoundRecord, RoundStep } from './types';

export const RUBRIC_VERSION = '1';

/** One criterion's score, and why. */
export interface CriterionScore {
  readonly id: string;
  /** In the user's language: `Completude`. */
  readonly label: string;
  /** 0 to 5; `null` when there was nothing to measure. */
  readonly score: number | null;
  readonly detail: string;
}

export interface DimensionScore {
  /** The mean of the criteria measured; `null` when none was. */
  readonly score: number | null;
  readonly criteria: readonly CriterionScore[];
}

export interface EfficiencyScore extends DimensionScore {
  /** Before scaling by effectiveness: resources and process only. */
  readonly base: number | null;
}

export interface ActorScore {
  /** The eliminatory rules it broke; any makes both scores 0. */
  readonly eliminated: readonly string[];
  readonly effectiveness: DimensionScore;
  readonly efficiency: EfficiencyScore;
}

export interface RoundScore {
  readonly version: string;
  readonly actors: Readonly<Record<string, ActorScore>>;
  /** The mean of the agents', plus the round's own limits. */
  readonly round: {
    readonly effectiveness: DimensionScore;
    readonly efficiency: { readonly score: number | null };
  };
}

/** Rules that, broken, leave nothing to score. */
const ELIMINATORY: Readonly<Record<string, string>> = {
  'read-only-respected': 'alterou arquivos com o pedido de não alterar',
  'no-tool-call-as-text':
    'respondeu com uma chamada de ferramenta escrita como texto',
};

/**
 * `map[key]`, `undefined` when there is none: the same type under both
 * typechecks (the pages' has `noUncheckedIndexedAccess`, the root's not).
 */
function entry<T>(
  map: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return map !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const mean = (values: readonly (number | null)[]): number | null => {
  const measured = values.filter((value) => value !== null);
  return measured.length === 0
    ? null
    : round1(measured.reduce((a, b) => a + b, 0) / measured.length);
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Less is better: 5 at or under `RUBRIC.best` of the reference, 3 at the
 * reference, 0 at `RUBRIC.worst` or more; straight lines in between.
 */
export function ratioScore(value: number, reference: number): number {
  const ratio = value / reference;
  const { best, worst } = RUBRIC;
  if (ratio <= best) return 5;
  if (ratio <= 1) return round1(5 - (2 * (ratio - best)) / (1 - best));
  if (ratio >= worst) return 0;
  return round1(3 - (3 * (ratio - 1)) / (worst - 1));
}

const stepsOf = (record: RoundRecord, actor: string): RoundStep[] =>
  record.steps.filter((step) => step.actor === actor);

function eliminations(record: RoundRecord, actor: string): string[] {
  const reasons = record.violations
    .filter(
      (v) =>
        v.actor === actor && !v.passed && Object.hasOwn(ELIMINATORY, v.rule),
    )
    .map((v) => ELIMINATORY[v.rule] ?? v.rule);
  const last = stepsOf(record, actor).at(-1);
  if (last !== undefined && last.said.join('').trim().length === 0) {
    reasons.push('terminou sem entregar nada');
  }
  return reasons;
}

function completeness(record: RoundRecord, actor: string): CriterionScore {
  const points = entry(record.criteria?.expected, actor);
  const label = 'Completude';
  if (points === undefined) {
    return {
      id: 'completeness',
      label,
      score: null,
      detail: 'Sem gabarito (expected) para este agente.',
    };
  }
  const said = stepsOf(record, actor)
    .flatMap((step) => step.said)
    .join('\n')
    .toLocaleLowerCase('pt-BR');
  const missing = points.filter(
    (point) => !said.includes(point.toLocaleLowerCase('pt-BR')),
  );
  const found = points.length - missing.length;
  return {
    id: 'completeness',
    label,
    score: round1((5 * found) / points.length),
    detail:
      missing.length === 0
        ? `Achou os ${String(points.length)} pontos do gabarito.`
        : `Achou ${String(found)} de ${String(points.length)} pontos do gabarito; faltou: ${missing.join('; ')}.`,
  };
}

function references(record: RoundRecord, actor: string): CriterionScore {
  const label = 'Referências corretas';
  const checked = stepsOf(record, actor)
    .map((step) => step.references)
    .filter((refs) => refs !== null);
  const cited = checked.reduce((total, refs) => total + refs.cited, 0);
  if (checked.length === 0 || cited === 0) {
    return {
      id: 'references',
      label,
      score: null,
      detail:
        checked.length === 0
          ? 'Sem ponto de partida no git: as referências não foram conferidas.'
          : 'Não citou nenhum arquivo:linha.',
    };
  }
  const valid = checked.reduce((total, refs) => total + refs.valid, 0);
  const invalid = checked.flatMap((refs) => refs.invalid);
  return {
    id: 'references',
    label,
    score: round1((5 * valid) / cited),
    detail:
      invalid.length === 0
        ? `As ${String(cited)} referências arquivo:linha existem.`
        : `${String(valid)} de ${String(cited)} referências existem; não existem: ${invalid.join(', ')}.`,
  };
}

function limit(
  id: string,
  label: string,
  value: number | null,
  max: number | undefined,
  show: (value: number) => string,
): CriterionScore {
  if (max === undefined)
    return { id, label, score: null, detail: 'Sem limite declarado.' };
  if (value === null) return { id, label, score: null, detail: 'Não medido.' };
  return {
    id,
    label,
    // Over the limit, the goal was not met.
    score: value <= max ? 5 : 0,
    detail:
      value <= max
        ? `${show(value)}, dentro do limite de ${show(max)}.`
        : `${show(value)}, acima do limite de ${show(max)}.`,
  };
}

const seconds = (ms: number): string => `${String(Math.round(ms / 1000))} s`;
const tokens = (n: number): string =>
  `${String(Math.round(n / 1000))} mil tokens novos`;

function resource(
  id: string,
  label: string,
  value: number | null,
  history: readonly (number | null)[],
  show: (value: number) => string,
): CriterionScore {
  const reference = median(
    history.filter((v): v is number => v !== null && v > 0),
  );
  if (value === null)
    return { id, label, score: null, detail: 'Não medido nesta rodada.' };
  if (reference === null) {
    return {
      id,
      label,
      score: null,
      detail: `${show(value)}; sem rodadas anteriores para comparar.`,
    };
  }
  return {
    id,
    label,
    score: ratioScore(value, reference),
    detail: `${show(value)}, contra a mediana de ${show(reference)} nas rodadas anteriores.`,
  };
}

function process(record: RoundRecord, actor: string): CriterionScore {
  const steps = stepsOf(record, actor);
  const questions = steps.reduce((total, step) => total + step.asked.length, 0);
  const errors = steps.reduce(
    (total, step) =>
      total + step.tools.filter((tool) => tool.outcome === 'error').length,
    0,
  );
  const denied =
    entry(record.actors, actor)?.network.decisions.filter(
      (d) => d.decision === 'deny' && d.decidedBy !== 'provider',
    ).length ?? 0;
  const waste = questions + errors + denied;
  const parts = [
    questions > 0 ? `${String(questions)} pergunta(s)` : '',
    errors > 0 ? `${String(errors)} ferramenta(s) com erro` : '',
    denied > 0 ? `${String(denied)} destino(s) de rede negado(s)` : '',
  ].filter(Boolean);
  return {
    id: 'process',
    label: 'Processo sem desperdício',
    score: Math.max(0, 5 - waste * RUBRIC.wastePenalty),
    detail:
      parts.length === 0
        ? 'Nenhum desperdício: sem perguntas, erros ou tentativas negadas.'
        : `${parts.join(', ')}.`,
  };
}

function actorScore(
  record: RoundRecord,
  actor: string,
  history: readonly RoundRecord[],
): ActorScore {
  const eliminated = eliminations(record, actor);
  const effectivenessCriteria = [
    completeness(record, actor),
    references(record, actor),
    limit(
      'time-limit',
      'Limite de tempo',
      entry(record.timing.actors, actor)?.durationMs ?? null,
      entry(record.criteria?.limits?.actorMs, actor),
      seconds,
    ),
  ];
  const resourceCriteria = [
    resource(
      'time',
      'Tempo gasto',
      entry(record.timing.actors, actor)?.durationMs ?? null,
      history.map((r) => entry(r.timing.actors, actor)?.durationMs ?? null),
      seconds,
    ),
    resource(
      'fresh-tokens',
      'Tokens novos',
      entry(record.totals.actors, actor)?.fresh ?? null,
      history.map((r) => entry(r.totals.actors, actor)?.fresh ?? null),
      tokens,
    ),
  ];
  const processCriterion = process(record, actor);
  const efficiencyCriteria = [...resourceCriteria, processCriterion];

  if (eliminated.length > 0) {
    return {
      eliminated,
      effectiveness: { score: 0, criteria: effectivenessCriteria },
      efficiency: { score: 0, base: 0, criteria: efficiencyCriteria },
    };
  }
  const effectiveness = mean(effectivenessCriteria.map((c) => c.score));
  // Resources and process weigh the same: the resources' mean, then the process.
  const base = mean([
    mean(resourceCriteria.map((c) => c.score)),
    processCriterion.score,
  ]);
  return {
    eliminated,
    effectiveness: { score: effectiveness, criteria: effectivenessCriteria },
    efficiency: {
      base,
      score:
        base === null || effectiveness === null
          ? null
          : round1((base * effectiveness) / 5),
      criteria: efficiencyCriteria,
    },
  };
}

/**
 * The round's scores. `history`: the earlier rounds of the same test, the
 * reference for time and tokens (their median, per agent).
 */
export function scoreRound(
  record: RoundRecord,
  history: readonly RoundRecord[],
): RoundScore {
  const actors = Object.fromEntries(
    Object.keys(record.actors).map((actor) => [
      actor,
      actorScore(record, actor, history),
    ]),
  );
  const limits = record.criteria?.limits;
  const roundCriteria = [
    limit(
      'round-time-limit',
      'Limite de tempo da rodada',
      record.timing.durationMs,
      limits?.roundMs,
      seconds,
    ),
    limit(
      'round-cost-limit',
      'Limite de custo da rodada',
      record.totals.round.costUsd,
      limits?.costUsd,
      (usd) => `US$ ${usd.toFixed(2)}`,
    ),
  ];
  const scores = Object.values(actors);
  return {
    version: RUBRIC_VERSION,
    actors,
    round: {
      effectiveness: {
        score: mean([
          ...scores.map((s) => s.effectiveness.score),
          ...roundCriteria.map((c) => c.score),
        ]),
        criteria: roundCriteria,
      },
      efficiency: { score: mean(scores.map((s) => s.efficiency.score)) },
    },
  };
}
