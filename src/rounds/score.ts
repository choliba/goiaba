/**
 * The rubric: how a round is scored, from what its record holds. Pure and
 * without other modules' runtime code, so the pages score with it too.
 *
 * Per agent, 0 to 5 (rounds/README.md):
 * - effectiveness (what): did it do what its prompt asked, within its
 *   policy, whatever it cost;
 * - efficiency (how): what it spent and wasted to get there, scaled by the
 *   share of the goal it reached (most result for least resources);
 * - final: effectiveness and efficiency weighed together (`RUBRIC.weights`),
 *   efficiency before the scaling, or effectiveness would count twice.
 * The two are still shown apart: the final hides which way a change pushed.
 * An eliminatory rule broken makes all three 0. A criterion with nothing to
 * measure is `null` (not evaluated), never 0; without effectiveness there is
 * no final.
 *
 * Changing a criterion changes `RUBRIC_VERSION`: every round, old or new,
 * is scored by the same rubric, and the pages say which.
 */

import { RUBRIC } from './constants';
import { wildmatch } from '../policy/wildmatch';
import { checkLimits, type Measured } from './criteria';
import { statusPath, writableOf } from './permissions';
import type { RoundCriterion, RoundRecord, RoundStep } from './types';

export const RUBRIC_VERSION = '3';

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
  /**
   * `weights.effectiveness × effectiveness + weights.efficiency × efficiency
   * base`; `null` without effectiveness.
   */
  readonly final: number | null;
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
    /** The round's effectiveness and its agents' mean efficiency base, weighed. */
    readonly final: number | null;
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

/** The file/conditional criteria of its prompt, as checked at each step's end. */
function fileCriteria(record: RoundRecord, actor: string): CriterionScore {
  const label = 'Critérios do prompt';
  const results = stepsOf(record, actor).flatMap((step) => step.criteria);
  if (results.length === 0) {
    return {
      id: 'criteria',
      label,
      score: null,
      detail:
        'Nenhum critério conferível de arquivo declarado para este agente.',
    };
  }
  const met = results.filter((result) => result.met).length;
  const missed = results.filter((result) => !result.met);
  return {
    id: 'criteria',
    label,
    score: round1((5 * met) / results.length),
    detail:
      missed.length === 0
        ? `Cumpriu os ${String(results.length)} critérios: ${results.map((r) => r.detail).join(' ')}`
        : `Cumpriu ${String(met)} de ${String(results.length)}. ${missed.map((r) => r.detail).join(' ')}`,
  };
}

/** The limit criteria (time/tokens/cost) compared with what was measured. */
function limitScores(
  prefix: string,
  label: string,
  criteria: readonly RoundCriterion[],
  measured: Measured,
): CriterionScore[] {
  return checkLimits(criteria, measured).map((result, index) => ({
    id: `${prefix}-${String(index)}`,
    label,
    score: result.met ? 5 : 0,
    detail: result.detail,
  }));
}

/**
 * Stayed within what its policy allows: changed nothing outside where it may
 * write (when told not to change files) and tried no destination the policy
 * denies. Not evaluated for an agent with neither a policy nor `readOnly`.
 */
function policy(record: RoundRecord, actor: string): CriterionScore {
  const label = 'Permissões';
  const snapshot = entry(record.actors, actor);
  if (
    snapshot === undefined ||
    (snapshot.policy === null && !snapshot.readOnly)
  ) {
    return {
      id: 'policy',
      label,
      score: null,
      detail: 'Sem política nem readOnly para conferir.',
    };
  }
  const writable = writableOf(snapshot.policy);
  const outside =
    snapshot.readOnly && record.start !== null
      ? stepsOf(record, actor)
          .flatMap((step) => step.changed)
          .filter(
            (line) =>
              !writable.some((pattern) => wildmatch(statusPath(line), pattern)),
          )
      : [];
  const denied = snapshot.network.decisions.filter(
    (d) => d.decision === 'deny' && d.decidedBy !== 'provider',
  );
  if (outside.length > 0) {
    return {
      id: 'policy',
      label,
      score: 0,
      detail: `Alterou fora do que a política libera para escrita: ${outside.join(', ')}.`,
    };
  }
  return {
    id: 'policy',
    label,
    score: Math.max(0, 5 - denied.length * RUBRIC.wastePenalty),
    detail:
      denied.length === 0
        ? 'Ficou dentro da política: nada alterado fora do permitido, nenhum destino negado.'
        : `${String(denied.length)} destino(s) de rede negado(s) pela política: ${denied.map((d) => d.destination).join(', ')}.`,
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
  // Denied attempts are the policy's: scored in Permissões, not here.
  const waste = questions + errors;
  const parts = [
    questions > 0 ? `${String(questions)} pergunta(s)` : '',
    errors > 0 ? `${String(errors)} ferramenta(s) com erro` : '',
  ].filter(Boolean);
  return {
    id: 'process',
    label: 'Processo sem desperdício',
    score: Math.max(0, 5 - waste * RUBRIC.wastePenalty),
    detail:
      parts.length === 0
        ? 'Nenhum desperdício: sem perguntas nem ferramentas com erro.'
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
    fileCriteria(record, actor),
    policy(record, actor),
    references(record, actor),
    ...limitScores(
      'actor-limit',
      'Limite do agente',
      record.criteria?.[actor] ?? [],
      {
        ms: entry(record.timing.actors, actor)?.durationMs ?? null,
        tokens: entry(record.totals.actors, actor)?.fresh ?? null,
        cost: entry(record.totals.actors, actor)?.costUsd ?? null,
      },
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
      final: 0,
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
    final: finalOf(effectiveness, base),
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

/** The final score: effectiveness and efficiency (its base) weighed. */
export function finalOf(
  effectiveness: number | null,
  base: number | null,
): number | null {
  if (effectiveness === null) return null;
  const { weights } = RUBRIC;
  // Without an efficiency base, effectiveness alone.
  if (base === null) return effectiveness;
  return round1(
    weights.effectiveness * effectiveness + weights.efficiency * base,
  );
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
  const roundCriteria = limitScores(
    'round-limit',
    'Limite da rodada',
    record.criteria?.round ?? [],
    {
      ms: record.timing.durationMs,
      tokens: record.totals.round.fresh,
      cost: record.totals.round.costUsd,
    },
  );
  const scores = Object.values(actors);
  const effectiveness = mean([
    ...scores.map((s) => s.effectiveness.score),
    ...roundCriteria.map((c) => c.score),
  ]);
  return {
    version: RUBRIC_VERSION,
    actors,
    round: {
      effectiveness: { score: effectiveness, criteria: roundCriteria },
      efficiency: { score: mean(scores.map((s) => s.efficiency.score)) },
      final: finalOf(effectiveness, mean(scores.map((s) => s.efficiency.base))),
    },
  };
}
