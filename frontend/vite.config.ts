import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Aucun port figé : PORT (variable d'environnement) sinon valeur par défaut de Vite.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  plugins: [react()],
  server: { host: true, port, strictPort: !!port },
  preview: { host: true, port, strictPort: !!port },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
