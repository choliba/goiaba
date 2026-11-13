/**
 * The top of every page, in two rows. Above, what is the same everywhere:
 * the site's name (back to the index) on the left, and on the right the
 * button that lists every test in a dialog, with a search. Below, the most
 * recent tests (`RECENT_TESTS`), each with how many rounds it ran; the
 * current one is marked, not a link.
 */

import { useState, type ReactNode } from 'react';

import { RECENT_TESTS } from '../constants';
import { lastRun, recentTests, type Test } from '../data';
import { count, goalOf, when } from '../format';
import { createHref, indexHref, testHref, useRoute } from '../route';
import { Modal } from './Modal';

function Chip({
  test,
  current,
}: {
  readonly test: Test;
  readonly current: boolean;
}): ReactNode {
  const content = (
    <>
      {test.title}
      <span
        className="rounds-count"
        aria-label={count(test.rounds.length, 'rodada', 'rodadas')}
      >
        {test.rounds.length}
      </span>
    </>
  );
  // The goal on hover: tests of the same declaration differ there.
  return current ? (
    <span aria-current="page" title={goalOf(test.goal)}>
      {content}
    </span>
  ) : (
    <a href={testHref(test.key)} title={goalOf(test.goal)}>
      {content}
    </a>
  );
}

function AllTests({
  current,
  onClose,
}: {
  readonly current: string | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const words = query.toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
  const shown = recentTests.filter((test) => {
    const text = `${test.title} ${test.goal} ${test.key}`.toLocaleLowerCase(
      'pt-BR',
    );
    return words.every((word) => text.includes(word));
  });
  return (
    <>
      <input
        type="search"
        placeholder="Buscar pelo id ou pelo objetivo"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Buscar testes"
        autoFocus
      />
      <ol className="all-tests">
        {shown.map((test) => (
          <li key={test.key}>
            <a
              href={testHref(test.key)}
              onClick={onClose}
              aria-current={test.key === current ? 'page' : undefined}
            >
              <small>
                {count(test.rounds.length, 'rodada', 'rodadas')} · última em{' '}
                {when(lastRun(test))}
              </small>
              <b>{test.title}</b>
              <span>{goalOf(test.goal)}</span>
            </a>
          </li>
        ))}
      </ol>
      {shown.length === 0 && (
        <p className="note">Nenhum teste com essa busca.</p>
      )}
    </>
  );
}

export function TestsNav({
  current,
}: {
  /** The key of the test being shown; none on the index. */
  readonly current?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const show = (): void => setOpen(true);
  const close = (): void => setOpen(false);
  const recent = recentTests.slice(0, RECENT_TESTS);
  const others = recentTests.length - recent.length;
  // A link home from every page but home itself.
  const onIndex = useRoute().page === 'index';

  return (
    <header className="topbar">
      <div className="topbar-row">
        {onIndex ? (
          <span className="brand" aria-current="page">
            Rodadas
          </span>
        ) : (
          <a className="brand" href={indexHref()}>
            Rodadas
          </a>
        )}
        <span className="topbar-actions">
          <a className="all-tests-button" href={createHref()}>
            Criar rodada
          </a>
          <button
            type="button"
            className="all-tests-button"
            onClick={show}
            aria-haspopup="dialog"
          >
            Todos os testes
            <span className="rounds-count">{recentTests.length}</span>
          </button>
        </span>
      </div>
      <nav className="recent" aria-label="Testes recentes">
        {/* The index lists every test, with their latest rounds. */}
        <a
          className="recent-label"
          href={indexHref()}
          aria-current={current === undefined ? 'page' : undefined}
        >
          {others > 0
            ? `Recentes (${String(recent.length)} de ${String(recentTests.length)})`
            : 'Recentes'}
        </a>
        <ol>
          {recent.map((test) => (
            <li key={test.key}>
              <Chip test={test} current={test.key === current} />
            </li>
          ))}
        </ol>
      </nav>
      <Modal title="Todos os testes" open={open} onClose={close}>
        <AllTests current={current} onClose={close} />
      </Modal>
    </header>
  );
}
