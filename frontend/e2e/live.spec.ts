import { expect, test, type Page } from '@playwright/test';
import { buildSnapshot } from '../src/mocks/scenarios';
import type { Snapshot } from '../src/types';
import { open } from './helpers';

/** Instantané « API réelle » : même forme que le contrat, mais demo=false et rien de fictif. */
function liveSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const s = buildSnapshot('nominal');
  return { ...s, demo: false, events: s.events.map((e) => ({ ...e, fictional: false })), thresholds: { ...s.thresholds, pilot_frozen: true }, ...over };
}
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function goLive(page: Page, query = '', mode = 'live') {
  await page.addInitScript((m) => {
    window.__VEILLE__ = { apiMode: m };
  }, mode);
  await page.goto(`/${query}#/vue`);
}
/** Le flux SSE n'a pas de serveur : on le refuse, la puce « flux interrompu » l'indique. */
async function noStream(page: Page) {
  await page.route('**/api/v1/stream', (r) => r.abort());
}

test.describe('mode API réelle (live)', () => {
  test('aucun bandeau ni mention « fictif » ; requêtes uniquement vers /api de la même origine', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('data:')) urls.push(new URL(r.url()).pathname + new URL(r.url()).search);
    });
    await noStream(page);
    await page.route('**/api/v1/overview*', (r) => r.fulfill(json(liveSnapshot())));
    await goLive(page);
    await expect(page.locator('.gauge')).toBeVisible();
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    await expect(page.locator('.map-badge')).toHaveCount(0);
    await expect(page.getByTestId('scenario-select')).toHaveCount(0);
    await expect(page.getByText(/fictiv/i)).toHaveCount(0);
    await expect(page).toHaveTitle('VEILLE — observatoire de situation');
    await page.getByTestId('ev-EV-001').click();
    await expect(page.getByTestId('event-card')).not.toContainText('Donnée fictive');
    await expect(page.getByTestId('ai-mode')).toBeVisible();
    await expect(page.getByText('Flux interrompu')).toBeVisible();
    expect(urls.filter((u) => u.startsWith('/api/'))).toContain('/api/v1/overview?territory=FR');
    expect(urls.filter((u) => !/^\/(api\/|assets\/|config\.js|favicon|$|\?)/.test(u) && !u.startsWith('/?'))).toEqual([]);
  });

  test('API injoignable : erreur explicite, AUCUNE donnée fictive, reprise au clic', async ({ page }) => {
    await noStream(page);
    await page.route('**/api/v1/overview*', (r) => r.abort());
    await goLive(page);
    const err = page.getByTestId('api-error');
    await expect(err).toContainText('API injoignable');
    await expect(err).toContainText('Aucune donnée fictive n’est utilisée en remplacement');
    await expect(page.locator('.gauge')).toHaveCount(0);
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    await expect(page.getByText('Convergence préoccupante')).toHaveCount(0);
    // l'API revient
    await page.unroute('**/api/v1/overview*');
    await page.route('**/api/v1/overview*', (r) => r.fulfill(json(liveSnapshot())));
    await page.getByTestId('api-retry').click();
    await expect(page.locator('.gauge')).toBeVisible();
    await expect(page.getByTestId('api-error')).toHaveCount(0);
  });

  test('HTTP 503 du relais et réponse non JSON : messages distincts', async ({ page }) => {
    await noStream(page);
    await page.route('**/api/v1/overview*', (r) => r.fulfill({ status: 503, body: 'upstream down' }));
    await goLive(page);
    await expect(page.getByTestId('api-error')).toContainText('HTTP 503');
    await page.unroute('**/api/v1/overview*');
    await page.route('**/api/v1/overview*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>accueil</html>' }));
    await page.getByTestId('api-retry').click();
    await expect(page.getByTestId('api-error')).toContainText('illisible');
  });

  test('perte de l’API après chargement : données conservées, datées, signalées périmées', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-29T15:30:00Z') });
    await noStream(page);
    await page.route('**/api/v1/overview*', (r) => r.fulfill(json(liveSnapshot())));
    await goLive(page);
    await expect(page.locator('.gauge')).toBeVisible();
    await page.unroute('**/api/v1/overview*');
    await page.route('**/api/v1/overview*', (r) => r.abort());
    await page.clock.runFor(31_000);
    await expect(page.getByTestId('stale-banner')).toContainText('Connexion à l’API perdue');
    await expect(page.locator('.gauge')).toBeVisible(); // dernières données conservées
    await expect(page.getByTestId('api-error')).toHaveCount(0);
  });

  test('valeur de mode inconnue : configuration invalide, aucune requête, aucune donnée fictive', async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
    await goLive(page, '', 'prod');
    await expect(page.getByTestId('api-error')).toContainText('Configuration invalide');
    await expect(page.getByTestId('api-error')).toContainText('prod');
    await expect(page.locator('.gauge')).toHaveCount(0);
    expect(api).toEqual([]);
  });

  test('seuils : écriture via l’API (PUT confirmé + motif + version attendue) quand pilot_frozen est levé', async ({ page }) => {
    await noStream(page);
    const snap = liveSnapshot();
    snap.thresholds = { ...snap.thresholds, pilot_frozen: false };
    await page.route('**/api/v1/overview*', (r) => r.fulfill(json(snap)));
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/v1/thresholds', async (r) => {
      body = r.request().postDataJSON();
      const t = { ...snap.thresholds, policy_version: 'seuils-v2', items: snap.thresholds.items.map((i) => (i.key === 'anomaly_mad_k' ? { ...i, value: 2.5 } : i)), history: [{ id: 'T-1', at: '2026-10-29T15:31:00Z', kind: 'modification', key: 'anomaly_mad_k', label: 'Écart de détection d’anomalie', from: 3, to: 2.5, reason: 'Essai de test serveur', actor: 'David', policy_version: 'seuils-v2' }] };
      await r.fulfill(json(t));
    });
    await goLive(page);
    await page.goto('/#/reglages/seuils');
    await page.getByTestId('thr-anomaly_mad_k').fill('2.5');
    await page.getByTestId('thr-save').click();
    await page.getByTestId('thr-reason').fill('Essai de test serveur');
    await page.getByTestId('thr-ack').check();
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-history')).toContainText('Essai de test serveur');
    expect(body).toMatchObject({ confirmed: true, reason: 'Essai de test serveur', expected_policy_version: 'seuils-v1', changes: [{ key: 'anomaly_mad_k', to: 2.5 }] });
  });

  test('seuils gelés côté serveur : lecture seule en mode live', async ({ page }) => {
    await noStream(page);
    await page.route('**/api/v1/overview*', (r) => r.fulfill(json(liveSnapshot())));
    await goLive(page);
    await page.getByTestId('settings-btn').click();
    await page.getByTestId('reglages-seuils').click();
    await expect(page.getByTestId('frozen-banner')).toBeVisible();
    await expect(page.getByTestId('thr-save')).toHaveCount(0);
  });
});

test.describe('mode maquette (mock) : inchangé', () => {
  test('config.js par défaut ne force rien ; bandeau fictif présent ; aucune requête /api', async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
    await open(page);
    await expect(page.locator('.demo-bar')).toBeVisible();
    await expect(page.getByText('Maquette hors ligne')).toBeVisible();
    expect(api).toEqual([]);
    const cfg = await page.evaluate(() => JSON.stringify(window.__VEILLE__));
    expect(cfg).toBe('{}');
  });
  test('mode « mock » explicite = même comportement', async ({ page }) => {
    await goLive(page, '', 'mock');
    await expect(page.locator('.demo-bar')).toBeVisible();
  });
});
