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

/**
 * A table row that opens `href` when clicked anywhere: the row's own link
 * stays for the keyboard, and a click on another link inside it (a round of
 * the test, say) still goes there.
 */
export function rowLink(href: string): {
  readonly className: string;
  readonly onClick: (event: { readonly target: EventTarget }) => void;
} {
  return {
    className: 'row-link',
    onClick: ({ target }) => {
      if (
        target instanceof Element &&
        target.closest('a, summary, button') !== null
      ) {
        return;
      }
      window.location.hash = href.slice(1);
    },
  };
}
