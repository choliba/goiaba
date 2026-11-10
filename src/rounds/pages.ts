/**
 * The rounds' pages, served: the built pages (rounds/web/dist, shipped in the
 * package) and the records of the configured `rounds.data`, as one JSON
 * (`rounds.json`) the pages read when they open. In this repository, during
 * development, Vite serves the pages and the same payload (payload.ts).
 */

import { UsageError } from '../errors';
import {
  extname,
  isWithin,
  join,
  pathExists,
  readText,
  resolve,
} from '../filesystem/index';
import { ROUNDS_JSON } from './constants';
import { roundsPayload } from './payload';

/** The media types the built pages use. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface PagesServer {
  readonly url: string;
  stop(): Promise<void>;
}

/**
 * Serves the built pages from `dist` and the records of `data`, on
 * `localhost:<port>`. A path outside `dist` is not served.
 */
export function servePages({
  dist,
  data,
  port,
}: {
  readonly dist: string;
  readonly data: string;
  readonly port: number;
}): PagesServer {
  if (!pathExists(join(dist, 'index.html'))) {
    throw new UsageError(
      `As páginas das rodadas não foram geradas em ${dist}. No repositório do Goiaba, rode bun run rounds:build.`,
    );
  }
  const server = Bun.serve({
    hostname: 'localhost',
    port,
    fetch: (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (path === `/${ROUNDS_JSON}`) {
        return new Response(roundsPayload(data), {
          headers: { 'content-type': TYPES['.json'] ?? '' },
        });
      }
      const file = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
      if (!isWithin(file, dist) || !pathExists(file)) {
        return new Response('Não encontrado.', { status: 404 });
      }
      return new Response(readText(file), {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        },
      });
    },
  });
  return {
    url: `http://localhost:${String(server.port)}/`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
