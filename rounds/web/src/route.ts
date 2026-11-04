/**
 * Where the reader is, in the hash: `#/` the index, `#/teste/<key>` a test,
 * `#/rodada/<id>` a round. A hash keeps the pages static: dist/ opens from
 * a file or any folder.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { readonly page: 'index' }
  | { readonly page: 'test'; readonly key: string }
  | { readonly page: 'round'; readonly id: string };

export function parse(hash: string): Route {
  const match = /^#\/(teste|rodada)\/(.+)$/.exec(hash);
  const value = match?.[2];
  if (value === undefined) return { page: 'index' };
  return match?.[1] === 'teste'
    ? { page: 'test', key: decodeURIComponent(value) }
    : { page: 'round', id: decodeURIComponent(value) };
}

export const indexHref = (): string => '#/';
export const testHref = (key: string): string =>
  `#/teste/${encodeURIComponent(key)}`;
export const roundHref = (id: string): string =>
  `#/rodada/${encodeURIComponent(id)}`;

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
