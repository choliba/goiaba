/**
 * Where the reader is, in the hash: `#/` the index, `#/rodada/<id>` a round.
 * A hash keeps the pages static: dist/ opens from a file or any folder.
 */

import { useEffect, useState } from 'react';

export type Route =
  { readonly page: 'index' } | { readonly page: 'round'; readonly id: string };

export function parse(hash: string): Route {
  const match = /^#\/rodada\/(.+)$/.exec(hash);
  return match?.[1] === undefined
    ? { page: 'index' }
    : { page: 'round', id: decodeURIComponent(match[1]) };
}

/** The index without `id`, a round's page with it. */
export const href = (id?: string): string =>
  id === undefined ? '#/' : `#/rodada/${encodeURIComponent(id)}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const update = (): void => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
