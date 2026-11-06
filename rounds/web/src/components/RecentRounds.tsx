/**
 * A test's latest rounds on one line, the latest first, and "Mais (n)"
 * opening a modal with all of them. The round being shown stays on the
 * line even when it is not among the latest: the page always says where
 * the reader is.
 */

import { useState, type ReactNode } from 'react';

import type { Round, Test } from '../data';
import { roundHref } from '../route';
import { Modal } from './Modal';
import { RoundsList } from './RoundsList';

export function RecentRounds({
  test,
  shown,
  current,
}: {
  readonly test: Test;
  /** How many of the latest rounds go on the line. */
  readonly shown: number;
  /** The id of the round being shown, if any. */
  readonly current?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const latest = test.rounds.toReversed().slice(0, shown);
  const here = test.rounds.find((round) => round.record.id === current);
  const line: Round[] =
    here === undefined || latest.includes(here) ? latest : [...latest, here];
  const others = test.rounds.length - line.length;

  return (
    <>
      <ol className="recent-rounds">
        {line.map((round, position) => {
          // The first says what the numbers are; the others are just numbers.
          const label =
            position === 0
              ? `Rodada ${String(round.index)}`
              : String(round.index);
          const name = `Rodada ${String(round.index)}`;
          return (
            <li key={round.record.id}>
              {round.record.id === current ? (
                <span aria-current="page" aria-label={name}>
                  {label}
                </span>
              ) : (
                <a href={roundHref(round.record.id)} aria-label={name}>
                  {label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {others > 0 && (
        <button
          type="button"
          className="more-rounds"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          Mais ({others})
        </button>
      )}
      <Modal
        title={`Rodadas de ${test.title}`}
        open={open}
        onClose={() => setOpen(false)}
      >
        <RoundsList
          test={test}
          current={current}
          onNavigate={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
