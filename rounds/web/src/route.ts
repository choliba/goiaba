/**
 * Where the reader is, in the hash: `#/` the index, `#/teste/<key>` a test,
 * `#/rodada/<id>` a round (`?agente=<nome>` opens that agent as it ran),
 * `#/criar` the form that writes a new round's declaration. A hash keeps the pages static: dist/ opens from
 * a file or any folder.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { readonly page: 'index' }
  | { readonly page: 'create' }
  | { readonly page: 'test'; readonly key: string }
  | {
      readonly page: 'round';
      readonly id: string;
      /** The agent to open, as it ran in this round: `?agente=<nome>`. */
      readonly agent?: string;
    };

export function parse(hash: string): Route {
  if (hash === '#/criar') return { page: 'create' };
  const match = /^#\/(teste|rodada)\/(.+)$/.exec(hash);
  const value = match?.[2];
  if (value === undefined) return { page: 'index' };
  if (match?.[1] === 'teste') {
    return { page: 'test', key: decodeURIComponent(value) };
  }
  const [id = '', query = ''] = value.split('?');
  const agent = new URLSearchParams(query).get('agente');
  return {
    page: 'round',
    id: decodeURIComponent(id),
    ...(agent === null ? {} : { agent }),
  };
}

export const indexHref = (): string => '#/';
export const createHref = (): string => '#/criar';
export const testHref = (key: string): string =>
  `#/teste/${encodeURIComponent(key)}`;
export const roundHref = (id: string, agent?: string): string =>
  `#/rodada/${encodeURIComponent(id)}${agent === undefined ? '' : `?agente=${encodeURIComponent(agent)}`}`;

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
        // A modal opened from the row is inside it in the DOM: its clicks are its own.
        target.closest('a, summary, button, dialog') !== null
      ) {
        return;
      }
      window.location.hash = href.slice(1);
    },
  };
}
