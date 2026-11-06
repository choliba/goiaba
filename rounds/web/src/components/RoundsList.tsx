/**
 * Every round of a test, the latest first, as the modal lists them: each
 * with its date, its final score and what changed since the one before, so
 * the reader can pick where to go. The round being shown is marked, not a
 * link.
 */

import type { ReactNode } from 'react';

import type { Round, Test } from '../data';
import { when } from '../format';
import { roundHref } from '../route';
import { changeSummary } from './Config';
import { Grade } from './Scores';

/** What changed since the round before, in a few words. */
function changes(round: Round): string {
  if (round.previous === undefined) return 'primeira rodada';
  const parts = changeSummary(round.record, round.previous);
  return parts.length === 0 ? 'nada: mesma configuração' : parts.join(', ');
}

export function RoundsList({
  test,
  current,
  onNavigate,
}: {
  readonly test: Test;
  /** The id of the round being shown, if any. */
  readonly current?: string;
  /** Called when a round is chosen: the modal closes. */
  readonly onNavigate: () => void;
}): ReactNode {
  return (
    <ol className="rounds-list">
      {test.rounds.toReversed().map((round) => {
        const content = (
          <>
            <b>Rodada {round.index}</b>
            <span className="muted">{when(round.record.timing.startedAt)}</span>
            <Grade score={round.score.round.final} />
            <span className="rounds-list-changes">{changes(round)}</span>
          </>
        );
        return (
          <li key={round.record.id}>
            {round.record.id === current ? (
              <span aria-current="page">{content}</span>
            ) : (
              <a href={roundHref(round.record.id)} onClick={onNavigate}>
                {content}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
