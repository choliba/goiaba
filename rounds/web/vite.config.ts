import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Where the rounds write their records: outside this project's root. */
const DATA = fileURLToPath(new URL('../data/', import.meta.url));

/** The module that reads them (`import.meta.glob`). */
const READER = fileURLToPath(new URL('src/data.ts', import.meta.url));

/**
 * In development, a round that just ran shows up without restarting: Vite
 * only watches its root (rounds/web), so a new record in rounds/data went
 * unseen until the glob was redone. A changed record was already seen (it
 * is in the module graph); a new or removed one now is too.
 */
function watchRecords(): Plugin {
  return {
    name: 'rounds-watch-records',
    configureServer(server) {
      server.watcher.add(DATA);
      const reload = (file: string): void => {
        if (!file.startsWith(DATA) || !file.endsWith('.json')) return;
        // The glob is expanded when data.ts is transformed: redo it.
        for (const module of server.moduleGraph.getModulesByFile(READER) ??
          []) {
          server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

// The pages of the rounds: static, read from rounds/data at build time.
// `base: './'` keeps every path relative, so dist/ opens from anywhere.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), watchRecords()],
  server: {
    // The records (../data) and the round types (../../src/rounds).
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
