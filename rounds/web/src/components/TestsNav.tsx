/**
 * The top of every page: the most recent tests (`RECENT_TESTS`), each with
 * how many rounds it ran, and a button that lists every test in a dialog,
 * with a search. The current test is marked, not a link.
 */

import { useRef, useState, type ReactNode } from 'react';

import { RECENT_TESTS } from '../constants';
import { lastRun, recentTests, type Test } from '../data';
import { count, when } from '../format';
import { indexHref, testHref } from '../route';

function Chip({
  test,
  current,
}: {
  readonly test: Test;
  readonly current: boolean;
}): ReactNode {
  const content = (
    <>
      <small>
        Teste {test.number} · {count(test.rounds.length, 'rodada', 'rodadas')}
      </small>
      {test.title}
    </>
  );
  return current ? (
    <span aria-current="page">{content}</span>
  ) : (
    <a href={testHref(test.key)}>{content}</a>
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
    const text =
      `${String(test.number)} ${test.title} ${test.definition.goal} ${test.definition.id}`.toLocaleLowerCase(
        'pt-BR',
      );
    return words.every((word) => text.includes(word));
  });
  return (
    <div className="dialog-body">
      <div className="dialog-head">
        <h2>Todos os testes</h2>
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label="Fechar"
        >
          ×
        </button>
      </div>
      <input
        type="search"
        placeholder="Buscar por número, título ou objetivo"
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
                Teste {test.number} ·{' '}
                {count(test.rounds.length, 'rodada', 'rodadas')} · última em{' '}
                {when(lastRun(test))}
              </small>
              <b>{test.title}</b>
              <span>{test.definition.goal}</span>
            </a>
          </li>
        ))}
      </ol>
      {shown.length === 0 && (
        <p className="note">Nenhum teste com essa busca.</p>
      )}
    </div>
  );
}

export function TestsNav({
  current,
}: {
  /** The key of the test being shown; none on the index. */
  readonly current?: string;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = (): void => {
    setOpen(true);
    dialog.current?.showModal();
  };
  const close = (): void => {
    dialog.current?.close();
  };
  const recent = recentTests.slice(0, RECENT_TESTS);
  const others = recentTests.length - recent.length;

  return (
    <nav className="tests" aria-label="Testes">
      <ol>
        <li>
          {current === undefined ? (
            <span aria-current="page">
              <small>Visão geral</small>Índice
            </span>
          ) : (
            <a href={indexHref()}>
              <small>Visão geral</small>Índice
            </a>
          )}
        </li>
        {recent.map((test) => (
          <li key={test.key}>
            <Chip test={test} current={test.key === current} />
          </li>
        ))}
        <li>
          <button
            type="button"
            className="more"
            onClick={show}
            aria-haspopup="dialog"
          >
            <small>{others > 0 ? `mais ${String(others)}` : 'lista'}</small>
            Todos os testes ({recentTests.length})
          </button>
        </li>
      </ol>
      <dialog
        ref={dialog}
        className="tests-dialog"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // A click on the backdrop (the dialog itself, outside its body) closes it.
          if (event.target === dialog.current) close();
        }}
      >
        {open && <AllTests current={current} onClose={close} />}
      </dialog>
    </nav>
  );
}
