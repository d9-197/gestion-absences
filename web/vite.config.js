import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, Vite relaie /api vers le conteneur api, comme nginx le fait en production.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://api:3000', changeOrigin: true },
    },
  },
});
