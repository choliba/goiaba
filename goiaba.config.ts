import { join } from 'node:path';
import { defineConfig } from './src/config/index.js';

const workpace = join(import.meta.dir, "app");

export default defineConfig({
  logDir: 'logs',
  debug: true,
  envs: [
    {
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      workpace: workpace
    },
  ],
});
