/**
 * A round's scores: effectiveness (what) and efficiency (how), 0 to 5, per
 * agent and for the round, each criterion with its reason. Not measured is
 * `—`, never 0.
 */

import { useState, type ReactNode } from 'react';

import type {
  ActorScore,
  CriterionScore,
  RoundScore,
} from '../../../../src/rounds/score';
import type { RoundRecord, ToolRecord } from '../../../../src/rounds/types';
import { NOT_MEASURED, title } from '../format';
import { Modal } from './Modal';
import { Badge, statusOf, type Status } from './Status';
import { ToolCall } from './ToolCall';
import { ToolList } from './ToolList';

/** `3,5`, or `—` when not evaluated. */
export const grade = (score: number | null): string =>
  score === null
    ? NOT_MEASURED
    : score.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** A score in the color of its situation (`statusOf`). */
export function Grade({ score }: { readonly score: number | null }): ReactNode {
  return <span className={`grade ${statusOf(score)}`}>{grade(score)}</span>;
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

/** How many of the criteria are in each situation, the measured ones only. */
function tally(score: ActorScore): Readonly<Record<Status, number>> {
  const counts: Record<Status, number> = {
    success: 0,
    warning: 0,
    danger: 0,
    info: 0,
    neutral: 0,
  };
  for (const criterion of [
    ...score.effectiveness.criteria,
    ...score.efficiency.criteria,
  ]) {
    if (criterion.score !== null) counts[statusOf(criterion.score)] += 1;
  }
  return counts;
}

const TALLY: readonly (readonly [Status, string, string])[] = [
  ['success', 'bom', 'bons'],
  ['warning', 'regular', 'regulares'],
  ['danger', 'ruim', 'ruins'],
];

/** A dimension's criteria, one per row: the score, what it is and why. */
function CriteriaRows({
  criteria,
}: {
  readonly criteria: readonly CriterionScore[];
}): ReactNode {
  return (
    <ul className="criteria-rows">
      {criteria.map((criterion) => (
        <li key={criterion.id}>
          <Grade score={criterion.score} />
          <div>
            <b>{criterion.label}</b>
            <p className="muted">{criterion.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Everything about one agent's score, organized: what the modal shows. */
function ActorDetails({
  score,
  failed,
}: {
  readonly score: ActorScore;
  readonly failed: readonly ToolRecord[];
}): ReactNode {
  return (
    <div className="actor-details">
      <dl className="grades">
        <div>
          <dt>Nota</dt>
          <dd>
            <Grade score={score.final} />
          </dd>
        </div>
        <div>
          <dt>Eficácia</dt>
          <dd>
            <Grade score={score.effectiveness.score} />
          </dd>
        </div>
        <div>
          <dt>Eficiência</dt>
          <dd>
            <Grade score={score.efficiency.score} />
          </dd>
        </div>
      </dl>
      {score.eliminated.length > 0 && (
        <p className="alert danger">
          <Badge status="danger">eliminado</Badge> {score.eliminated.join('; ')}
          . As duas notas ficam 0.
        </p>
      )}
      <section>
        <h3>
          Eficácia <span className="muted">o que foi entregue</span>
        </h3>
        <CriteriaRows criteria={score.effectiveness.criteria} />
      </section>
      <section>
        <h3>
          Eficiência <span className="muted">o que custou entregar</span>
        </h3>
        {score.efficiency.score === null && score.efficiency.base !== null && (
          <p className="muted">
            Sem a eficácia, a eficiência não vale; a base seria{' '}
            {grade(score.efficiency.base)}.
          </p>
        )}
        <CriteriaRows criteria={score.efficiency.criteria} />
      </section>
      {failed.length > 0 && (
        <ToolList
          heading={
            <>
              Ferramentas com erro{' '}
              <Badge status="danger">{failed.length}</Badge>
            </>
          }
          tools={failed}
        />
      )}
    </div>
  );
}

/**
 * One agent, in short: its scores and how many criteria went well or not.
 * The whole card opens the details.
 */
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
  const [open, setOpen] = useState(false);
  const counts = tally(score);
  return (
    <>
      <button
        type="button"
        className={`actor-card ${statusOf(score.final)}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="actor-card-head">
          <b>{title(name)}</b>
          <Grade score={score.final} />
        </span>
        <span className="actor-card-dimensions">
          <span>
            Eficácia <Grade score={score.effectiveness.score} />
          </span>
          <span>
            Eficiência <Grade score={score.efficiency.score} />
          </span>
        </span>
        <span className="actor-card-tally">
          {score.eliminated.length > 0 && (
            <Badge status="danger">eliminado</Badge>
          )}
          {TALLY.filter(([status]) => counts[status] > 0).map(
            ([status, one, many]) => (
              <Badge key={status} status={status}>
                {counts[status]} {counts[status] === 1 ? one : many}
              </Badge>
            ),
          )}
          {failed.length > 0 && (
            <Badge status="danger">
              {failed.length}{' '}
              {failed.length === 1
                ? 'ferramenta com erro'
                : 'ferramentas com erro'}
            </Badge>
          )}
        </span>
      </button>
      <Modal
        title={`${title(name)}: avaliação`}
        open={open}
        onClose={() => setOpen(false)}
      >
        <ActorDetails score={score} failed={failed} />
      </Modal>
    </>
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
