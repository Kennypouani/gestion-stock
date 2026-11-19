// ============================================================
// CONFIGURATION PLAYWRIGHT — parcours de bout en bout
//
// Un seul worker : les 3 scénarios partagent la même base jetable
// et s'enchaînent (inscription → vente → sauvegarde/restauration).
// Les serveurs (API + Vite) sont démarrés par e2e/harnais.js.
//
// Lancement : npm run test:e2e
// ============================================================
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // Démarrage des deux serveurs + parcours complet : marge confortable
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    headless: true,
    locale: 'fr-FR',
    viewport: { width: 1280, height: 900 },
  },
});
