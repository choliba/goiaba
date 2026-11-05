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
import { NOT_MEASURED, title } from '../format';

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
}: {
  readonly criteria: readonly CriterionScore[];
}): ReactNode {
  return (
    <ul className="criteria">
      {criteria.map((criterion) => (
        <li key={criterion.id}>
          <Grade score={criterion.score} /> <b>{criterion.label}</b>
          <span className="muted"> · {criterion.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function ActorCard({
  name,
  score,
}: {
  readonly name: string;
  readonly score: ActorScore;
}): ReactNode {
  return (
    <article className="actor">
      <h3>{title(name)}</h3>
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
        <Criteria criteria={score.efficiency.criteria} />
      </div>
    </article>
  );
}

export function Scores({ score }: { readonly score: RoundScore }): ReactNode {
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
        Rodada: eficácia <Grade score={score.round.effectiveness.score} />,
        eficiência <Grade score={score.round.efficiency.score} /> (médias dos
        agentes avaliados: {evaluated} de {actors.length}).
      </p>
      {roundCriteria.length > 0 && <Criteria criteria={roundCriteria} />}
      <div className="actors">
        {Object.entries(score.actors).map(([name, actorScore]) => (
          <ActorCard key={name} name={name} score={actorScore} />
        ))}
      </div>
    </section>
  );
}
