/**
 * A round's scores: effectiveness (what) and efficiency (how), 0 to 5, per
 * agent and for the round, each criterion with its reason. Not measured is
 * `—`, never 0.
 */

import type { ReactNode } from 'react';

import type {
  ActorScore,
  CriterionScore,
  RoundScore,
} from '../../../../src/rounds/score';
import type { RoundRecord, ToolRecord } from '../../../../src/rounds/types';
import { NOT_MEASURED, title } from '../format';
import { ToolCall } from './ToolCall';

/** `3,5`, or `—` when not evaluated. */
export const grade = (score: number | null): string =>
  score === null
    ? NOT_MEASURED
    : score.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** A score with its color: green from 4, amber from 2,5, red below. */
export function Grade({ score }: { readonly score: number | null }): ReactNode {
  const level =
    score === null
      ? 'none'
      : score >= 4
        ? 'high'
        : score >= 2.5
          ? 'mid'
          : 'low';
  return <span className={`grade ${level}`}>{grade(score)}</span>;
}

function Criteria({
  criteria,
  failed = [],
}: {
  readonly criteria: readonly CriterionScore[];
  /** The tools that failed, opened under the criterion that counts them. */
  readonly failed?: readonly ToolRecord[];
}): ReactNode {
  return (
    <ul className="criteria">
      {criteria.map((criterion) => (
        <li key={criterion.id}>
          <Grade score={criterion.score} /> <b>{criterion.label}</b>
          <span className="muted"> · {criterion.detail}</span>
          {criterion.id === 'process' && failed.length > 0 && (
            <ol className="tools">
              {failed.map((tool, i) => (
                <li key={i} className={tool.outcome}>
                  <ToolCall tool={tool} />
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActorCard({
  name,
  score,
  failed,
}: {
  readonly name: string;
  readonly score: ActorScore;
  /** Its tools that failed, the ones "Processo sem desperdício" counts. */
  readonly failed: readonly ToolRecord[];
}): ReactNode {
  return (
    <article className="actor">
      <h3 className="final">
        {title(name)} <span className="muted">nota</span>{' '}
        <Grade score={score.final} />
      </h3>
      {score.eliminated.length > 0 && (
        <p className="note warn">
          Eliminado: {score.eliminated.join('; ')}. As duas notas ficam 0.
        </p>
      )}
      <div className="dimension">
        <h4>
          Eficácia <Grade score={score.effectiveness.score} />
        </h4>
        <Criteria criteria={score.effectiveness.criteria} />
      </div>
      <div className="dimension">
        <h4>
          Eficiência <Grade score={score.efficiency.score} />
          {score.efficiency.score === null &&
            score.efficiency.base !== null && (
              <span className="muted">
                {' '}
                (sem a eficácia; base {grade(score.efficiency.base)})
              </span>
            )}
        </h4>
        <Criteria criteria={score.efficiency.criteria} failed={failed} />
      </div>
    </article>
  );
}

export function Scores({
  score,
  record,
}: {
  readonly score: RoundScore;
  readonly record: RoundRecord;
}): ReactNode {
  const failedOf = (actor: string): readonly ToolRecord[] =>
    record.steps
      .filter((step) => step.actor === actor)
      .flatMap((step) => step.tools.filter((tool) => tool.outcome === 'error'));
  const roundCriteria = score.round.effectiveness.criteria.filter(
    (c) => c.score !== null,
  );
  const actors = Object.values(score.actors);
  const evaluated = actors.filter((a) => a.effectiveness.score !== null).length;
  return (
    <section className="block" aria-labelledby="avaliacao">
      <h2 id="avaliacao">Avaliação</h2>
      <p className="note">
        Rubrica {score.version}: os critérios estão em rounds/README.md.
        Eficácia é o que foi entregue; eficiência, o que custou entregar.
        Rodada: nota <Grade score={score.round.final} />, eficácia{' '}
        <Grade score={score.round.effectiveness.score} />, eficiência{' '}
        <Grade score={score.round.efficiency.score} /> (agentes avaliados:{' '}
        {evaluated} de {actors.length}). Nota = 60% eficácia + 40% eficiência
        (antes da escala).
      </p>
      {roundCriteria.length > 0 && <Criteria criteria={roundCriteria} />}
      <div className="actors">
        {Object.entries(score.actors).map(([name, actorScore]) => (
          <ActorCard
            key={name}
            name={name}
            score={actorScore}
            failed={failedOf(name)}
          />
        ))}
      </div>
    </section>
  );
}
