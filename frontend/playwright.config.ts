import { defineConfig } from '@playwright/test';

// Port : variable d'environnement PORT (4173 = valeur par défaut de `vite preview`, uniquement pour les tests).
const port = process.env.PORT ?? '4173';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Chromium préinstallé dans l'environnement cloud ; en local Playwright utilise son propre navigateur.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
