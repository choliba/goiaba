/** The index, a test's page or a round's page, by the hash. */

import type { ReactNode } from 'react';

import { roundById, testByKey } from './data';
import { CreatePage } from './pages/CreatePage';
import { IndexPage } from './pages/IndexPage';
import { RoundPage } from './pages/RoundPage';
import { TestPage } from './pages/TestPage';
import { indexHref, useRoute } from './route';

function NotFound({ what }: { readonly what: string }): ReactNode {
  return (
    <main className="page">
      <header>
        <h1>Não encontrado</h1>
        <p>
          Não há {what} em rounds/data.{' '}
          <a href={indexHref()}>Ver todos os testes</a>.
        </p>
      </header>
    </main>
  );
}

export function App(): ReactNode {
  const route = useRoute();
  if (route.page === 'index') return <IndexPage />;
  if (route.page === 'create') return <CreatePage />;
  if (route.page === 'test') {
    const test = testByKey(route.key);
    return test === undefined ? (
      <NotFound what={`o teste ${route.key}`} />
    ) : (
      <TestPage test={test} />
    );
  }
  const round = roundById(route.id);
  return round === undefined ? (
    <NotFound what={`a rodada ${route.id}`} />
  ) : (
    // A new agent in the address opens it, even on the same round.
    <RoundPage
      key={`${route.id}?${route.agent ?? ''}`}
      round={round}
      agent={route.agent}
    />
  );
}
