import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The pages of the rounds: static, read from rounds/data at build time.
// `base: './'` keeps every path relative, so dist/ opens from anywhere.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  server: {
    // The records (../data) and the round types (../../src/rounds).
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
