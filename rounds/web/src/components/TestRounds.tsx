/**
 * A test and its rounds, as a bar under the top: on a round's page the test
 * links back and the round is marked; on the test's page the test is marked
 * and every round is a link.
 */

import type { ReactNode } from 'react';

import type { Test } from '../data';
import { roundHref, testHref } from '../route';

export function TestRounds({
  test,
  current,
}: {
  readonly test: Test;
  /** The id of the round being shown; none on the test's page. */
  readonly current?: string;
}): ReactNode {
  const name = (
    <>
      <small>
        {current === undefined ? '' : '← '}Teste {test.number}
      </small>
      {test.title}
    </>
  );
  return (
    <nav className="crumbs" aria-label="Rodadas do teste">
      {current === undefined ? (
        <span className="crumbs-test" aria-current="page">
          {name}
        </span>
      ) : (
        <a className="crumbs-test" href={testHref(test.key)}>
          {name}
        </a>
      )}
      <ol>
        {test.rounds.map((round) => (
          <li key={round.record.id}>
            {round.record.id === current ? (
              <span aria-current="page">Rodada {round.index}</span>
            ) : (
              <a href={roundHref(round.record.id)}>Rodada {round.index}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
