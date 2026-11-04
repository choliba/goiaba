/** The index or a round's page, by the hash. */

import type { ReactNode } from 'react';

import { roundById } from './data';
import { IndexPage } from './pages/IndexPage';
import { RoundPage } from './pages/RoundPage';
import { href, useRoute } from './route';

export function App(): ReactNode {
  const route = useRoute();
  if (route.page === 'index') return <IndexPage />;
  const round = roundById(route.id);
  if (round === undefined) {
    return (
      <main className="page">
        <header>
          <h1>Rodada não encontrada</h1>
          <p>
            Não há a rodada {route.id} em rounds/data.{' '}
            <a href={href()}>Ver todas</a>.
          </p>
        </header>
      </main>
    );
  }
  return <RoundPage round={round} />;
}
