import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH : chemin sous lequel l'application est publiée derrière un proxy (ex. /abs). Vide : à la racine.
const chemin = (process.env.BASE_PATH ?? '').replace(/\/+$/, '');

// En développement, Vite relaie /api vers le conteneur api, comme nginx le fait en production.
export default defineConfig({
  base: `${chemin}/`,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      [`${chemin}/api`]: { target: process.env.API_URL ?? 'http://api:3000', changeOrigin: true },
    },
  },
});
