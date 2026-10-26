import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O build do cliente vai para dist/public, onde o ServeStaticModule do Nest
// lê os arquivos em produção (monólito: API e frontend no mesmo processo).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // Em desenvolvimento, o Vite roda na 5173 e encaminha a API para o Nest.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
