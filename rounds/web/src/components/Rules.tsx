/**
 * The rules checked after a round, one result per agent and rule. They are
 * the round's, not an agent's: the round page shows them, who broke one
 * first.
 */

import { useState, type ReactNode } from 'react';

import type { RoundRecord, RuleResult } from '../../../../src/rounds/types';
import { title } from '../format';
import { Badge, type Status } from './Status';

/** What an agent asked in the round, the questions `no-questions` counts. */
const askedBy = (
  record: RoundRecord,
  actor: string | null,
): readonly string[] =>
  actor === null
    ? []
    : record.steps
        .filter((step) => step.actor === actor)
        .flatMap((step) => step.asked);

/** One result: kept or broken, the rule, whom it is about and why. */
function RuleLine({
  result,
  asked,
}: {
  readonly result: RuleResult;
  /** The agent's questions, shown under a broken `no-questions`. */
  readonly asked: readonly string[];
}): ReactNode {
  return (
    <li className={result.passed ? 'passed' : 'failed'}>
      <Badge status={result.passed ? 'success' : 'danger'}>
        {result.passed ? 'cumpriu' : 'violou'}
      </Badge>
      <span>
        <code>{result.rule}</code>
        {result.actor !== null && ` · ${title(result.actor)}`}: {result.detail}
      </span>
      {!result.passed && result.rule === 'no-questions' && asked.length > 0 && (
        <ul className="asked">
          {asked.map((question, index) => (
            <li key={index}>
              <pre>{question}</pre>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Which list is open under the heading: the broken ones, the kept ones, or none. */
type Shown = 'broken' | 'kept' | null;

/** A count next to the heading that opens its list (and closes the other). */
function Toggle({
  status,
  label,
  count,
  open,
  onToggle,
}: {
  readonly status: Status;
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`count-toggle ${status}`}
      aria-expanded={open}
      aria-controls="conferencias-lista"
      disabled={count === 0}
      onClick={onToggle}
    >
      {label} <b>{count}</b>
    </button>
  );
}

/**
 * The round's checks (its rules, per agent): how many were broken and how
 * many kept, next to the heading; each count opens its list. Both start
 * closed: the counts already say whether anyone broke a rule.
 */
export function Rules({ record }: { readonly record: RoundRecord }): ReactNode {
  const results = record.violations;
  const broken = results.filter((result) => !result.passed);
  const kept = results.filter((result) => result.passed);
  const [shown, setShown] = useState<Shown>(null);
  const toggle = (list: Exclude<Shown, null>): void => {
    setShown((current) => (current === list ? null : list));
  };
  const listed = shown === 'broken' ? broken : shown === 'kept' ? kept : [];
  return (
    <section className="block" aria-labelledby="conferencias">
      <div className="section-head">
        <h2 id="conferencias">Conferências</h2>
        {results.length > 0 && (
          <>
            <Toggle
              status="danger"
              label="Violadas"
              count={broken.length}
              open={shown === 'broken'}
              onToggle={() => toggle('broken')}
            />
            <Toggle
              status="success"
              label="Cumpridas"
              count={kept.length}
              open={shown === 'kept'}
              onToggle={() => toggle('kept')}
            />
          </>
        )}
      </div>
      {results.length === 0 && (
        <p className="note">
          {record.start === null
            ? 'Nenhuma regra conferida: sem o git, não há como saber o que cada agente alterou.'
            : 'A rodada não declarou regras.'}
        </p>
      )}
      {listed.length > 0 && (
        <ul className="rules" id="conferencias-lista">
          {listed.map((result, index) => (
            <RuleLine
              key={index}
              result={result}
              asked={askedBy(record, result.actor)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
