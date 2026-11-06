/**
 * A test and its rounds, as a bar under the top: on a round's page the test
 * links back and the round is marked; on the test's page the test is marked.
 * The latest rounds are on the line (`RECENT_ROUNDS_IN_BAR`), every one in
 * the modal behind "Mais (n)".
 */

import type { ReactNode } from 'react';

import { RECENT_ROUNDS_IN_BAR } from '../constants';
import type { Test } from '../data';
import { testHref } from '../route';
import { RecentRounds } from './RecentRounds';

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
      <small>{current === undefined ? 'teste' : '← teste'}</small>
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
      <RecentRounds
        test={test}
        shown={RECENT_ROUNDS_IN_BAR}
        current={current}
      />
    </nav>
  );
}
