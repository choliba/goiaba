import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { environment } from '../../src/execute/process.ts';
import { resolve } from '../../src/filesystem/index.ts';
import { ROUNDS_DATA_ENV, ROUNDS_JSON } from '../../src/rounds/constants.ts';
import { roundsPayload } from '../../src/rounds/payload.ts';

/**
 * Where the records are: `rounds.data`, given by `goiaba rounds` when it
 * starts Vite; this repository's rounds/data when Vite runs by itself
 * (`bun run rounds:web`).
 */
const DATA =
  environment()[ROUNDS_DATA_ENV] ??
  fileURLToPath(new URL('../data/', import.meta.url));

/**
 * The records as the pages fetch them when they open (`rounds.json`), the
 * same as the built pages get from `goiaba rounds:web`. A record that comes
 * or goes reloads the pages: a round that just ran shows up at once.
 */
function records(): Plugin {
  return {
    name: 'rounds-records',
    configureServer(server) {
      server.middlewares.use(`/${ROUNDS_JSON}`, (_request, response) => {
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(roundsPayload(DATA));
      });
      server.watcher.add(DATA);
      const reload = (file: string): void => {
        if (!resolve(file).startsWith(resolve(DATA))) return;
        if (!file.endsWith('.json')) return;
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('change', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

// The pages of the rounds: static, the records fetched when they open.
// `base: './'` keeps every path relative, so dist/ is served from anywhere.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), records()],
  build: { target: 'es2022' },
  server: {
    // The round types (../../src/rounds).
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
