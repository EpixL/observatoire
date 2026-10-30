import { expect, test, type Page, type Route } from '@playwright/test';
import { backendRoutes, SAMPLE_NOT_EVALUATED, sampleError, SAMPLE_THRESHOLDS } from '../src/mocks/backend-samples';
import { open } from './helpers';

/**
 * Mode API réelle : Playwright simule le BACKEND route par route (/api/v1/gauge, /events, /thresholds…) avec des réponses de forme
 * réelle (src/mocks/backend-samples.ts). Aucun backend n'est lancé ici : ces tests prouvent la composition et la gestion d'erreurs,
 * pas l'intégration avec le vrai serveur.
 */
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function goLive(page: Page, query = '', mode = 'live', hash = '#/vue') {
  await page.addInitScript((m) => {
    window.__VEILLE__ = { apiMode: m };
  }, mode);
  await page.goto(`/${query}${hash}`);
}
async function backend(page: Page, overrides: Record<string, unknown> = {}, status: Record<string, number> = {}) {
  const routes = backendRoutes(overrides);
  await page.route('**/api/v1/**', (r: Route) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/v1/stream') return r.abort(); // pas de SSE côté serveur : la puce « flux interrompu » l'indique
    if (!(path in routes)) return r.fulfill(json(sampleError('not_found', path), 404));
    return r.fulfill(json(routes[path], status[path] ?? 200));
  });
}

test.describe('mode API réelle (live) : vraies routes du backend', () => {
  test('aucun bandeau ni mention « fictif » ; seules des routes /api/v1 de la même origine sont appelées', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('data:')) urls.push(new URL(r.url()).pathname);
    });
    await backend(page);
    await goLive(page, '?territory=flanc-est');
    await expect(page.locator('.gauge')).toBeVisible();
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    await expect(page.locator('.map-badge')).toHaveCount(0);
    await expect(page.getByTestId('scenario-select')).toHaveCount(0);
    await expect(page.getByText(/fictiv/i)).toHaveCount(0);
    await expect(page).toHaveTitle('VEILLE — observatoire de situation');
    await expect(page.getByText('Flux interrompu')).toBeVisible();
    const api = urls.filter((u) => u.startsWith('/api/'));
    expect(api).toEqual(expect.arrayContaining(['/api/v1/territories', '/api/v1/gauge', '/api/v1/gauge/detail', '/api/v1/gauge/history', '/api/v1/dossiers', '/api/v1/events', '/api/v1/sources/status', '/api/v1/thresholds', '/api/v1/reviews']));
    expect(api).not.toContain('/api/v1/overview');
    expect(urls.filter((u) => !u.startsWith('/api/') && !/^\/(assets\/|config\.js|favicon|$)/.test(u))).toEqual([]);
  });

  test('forme réelle : nom de pays tiré du code, aucune pastille fictive, affirmations, effet sur l’indice', async ({ page }) => {
    await backend(page);
    await goLive(page, '?territory=flanc-est');
    await page.getByTestId('ev-EV-3').click();
    const card = page.getByTestId('event-card');
    await expect(card).toContainText('Lituanie — position indicative (échelle pays)');
    await expect(card).not.toContainText('Donnée fictive');
    await expect(card).toContainText('Critère rempli');
    await expect(page.getByTestId('claims')).toContainText('Non confirmée officiellement');
    await expect(card).toContainText('Cause commune possible');
    await page.getByTestId('view-europe').click();
    await expect(page.getByTestId('marker-EV-3')).toBeVisible();
  });

  test('ce que le serveur ne fournit pas est dit absent, jamais inventé', async ({ page }) => {
    await backend(page);
    await goLive(page, '?territory=flanc-est');
    await expect(page.getByTestId('conclusion')).toContainText('Conclusion rédigée indisponible');
    await expect(page.getByTestId('criteria').locator('li')).toHaveCount(8);
    await expect(page.getByTestId('civil-banner')).toHaveCount(0);
    await expect(page.getByTestId('nuclear-badge')).toHaveCount(0);
    await page.goto('/#/journal');
    await expect(page.getByTestId('journal-partial')).toBeVisible();
    await expect(page.getByTestId('reviews')).toContainText('Qualification hostile à valider');
    await page.goto('/#/dossiers');
    await page.getByTestId('tab-ia').click();
    await expect(page.getByTestId('ai-unavailable')).toBeVisible();
    await page.goto('/#/reglages/notifications');
    await expect(page.getByTestId('notif-readonly')).toBeVisible();
    await expect(page.getByTestId('notif-enabled')).toBeDisabled();
  });

  test('définitions des paliers : celles du backend', async ({ page }) => {
    await backend(page);
    await goLive(page, '?territory=flanc-est');
    await page.getByRole('button', { name: 'Comprendre l’échelle' }).click();
    await expect(page.getByRole('dialog')).toContainText('Ne prouve ni la paix ni un risque nul.');
  });

  test('territoire par défaut = celui du serveur ; sélecteur alimenté par /territories', async ({ page }) => {
    const gaugeCalls: string[] = [];
    page.on('request', (r) => /\/api\/v1\/gauge\?/.test(r.url()) && gaugeCalls.push(new URL(r.url()).search));
    await backend(page);
    await goLive(page);
    await expect(page.getByTestId('territory-select')).toBeVisible();
    await expect(page.getByTestId('territory-select').locator('option')).toHaveCount(2);
    expect(gaugeCalls[0]).toContain('territory=FR');
    await page.getByTestId('territory-select').selectOption('flanc-est');
    await expect.poll(() => gaugeCalls.some((c) => c.includes('territory=flanc-est'))).toBe(true);
  });

  test('jauge pas encore évaluée (404 not_evaluated) : non calculable explicite, le reste fonctionne', async ({ page }) => {
    await backend(page, { '/api/v1/gauge': SAMPLE_NOT_EVALUATED, '/api/v1/gauge/detail': SAMPLE_NOT_EVALUATED, '/api/v1/dossiers': SAMPLE_NOT_EVALUATED }, { '/api/v1/gauge': 404, '/api/v1/gauge/detail': 404, '/api/v1/dossiers': 404 });
    await goLive(page, '?territory=flanc-est');
    await expect(page.locator('.gauge svg')).toHaveAttribute('aria-label', /non calculable/);
    await expect(page.getByTestId('coverage')).toContainText('pas encore été évaluée');
    await expect(page.getByTestId('api-error')).toHaveCount(0);
  });

  test('API injoignable : erreur explicite, AUCUNE donnée fictive, reprise au clic', async ({ page }) => {
    await page.route('**/api/v1/**', (r) => r.abort());
    await goLive(page);
    const err = page.getByTestId('api-error');
    await expect(err).toContainText('API injoignable');
    await expect(err).toContainText('Aucune donnée fictive n’est utilisée en remplacement');
    await expect(page.locator('.gauge')).toHaveCount(0);
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    await expect(page.getByText('Convergence préoccupante')).toHaveCount(0);
    await page.unroute('**/api/v1/**');
    await backend(page);
    await page.getByTestId('api-retry').click();
    await expect(page.locator('.gauge')).toBeVisible();
    await expect(page.getByTestId('api-error')).toHaveCount(0);
  });

  test('HTTP 503, page d’accueil à la place de l’API, et dérive du contrat : trois messages distincts', async ({ page }) => {
    await page.route('**/api/v1/**', (r) => r.fulfill({ status: 503, body: 'upstream down' }));
    await goLive(page);
    await expect(page.getByTestId('api-error')).toContainText('HTTP 503');
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>accueil</html>' }));
    await page.getByTestId('api-retry').click();
    await expect(page.getByTestId('api-error')).toContainText('illisible');
    await page.unroute('**/api/v1/**');
    await backend(page, { '/api/v1/gauge': { ...(backendRoutes()['/api/v1/gauge'] as object), palier: 43 } });
    await page.getByTestId('api-retry').click();
    await expect(page.getByTestId('api-error')).toContainText('non conforme au contrat');
    await expect(page.getByTestId('api-error')).toContainText('palier');
  });

  test('perte de l’API après chargement : données conservées, datées, signalées périmées', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-30T10:00:00Z') });
    await backend(page);
    await goLive(page, '?territory=flanc-est');
    await expect(page.locator('.gauge')).toBeVisible();
    await page.unroute('**/api/v1/**');
    await page.route('**/api/v1/**', (r) => r.abort());
    await page.clock.runFor(31_000);
    await expect(page.getByTestId('stale-banner')).toContainText('Connexion à l’API perdue');
    await expect(page.locator('.gauge')).toBeVisible();
    await expect(page.getByTestId('api-error')).toHaveCount(0);
  });

  test('valeur de mode inconnue : configuration invalide, aucune requête, aucune donnée fictive', async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
    await goLive(page, '', 'prod');
    await expect(page.getByTestId('api-error')).toContainText('Configuration invalide');
    await expect(page.locator('.gauge')).toHaveCount(0);
    expect(api).toEqual([]);
  });
});

test.describe('mode live : seuils (le backend n’envoie pas pilot_frozen)', () => {
  test('pilot_frozen absent = gelé : lecture seule, aucun bouton d’édition', async ({ page }) => {
    await backend(page);
    await goLive(page, '?territory=flanc-est', 'live', '#/reglages/seuils');
    await expect(page.getByTestId('frozen-banner')).toBeVisible();
    await expect(page.getByTestId('thr-save')).toHaveCount(0);
    await expect(page.getByTestId('thr-events_for_40')).toHaveValue('3');
    await expect(page.getByTestId('thr-status')).toContainText('1 seuil différent du plan');
    await expect(page.getByTestId('thr-history')).toContainText('essai de sensibilité');
  });

  test('pilot_frozen=false explicite : PUT avec confirmation, motif, version attendue ; erreurs du serveur affichées', async ({ page }) => {
    await backend(page, { '/api/v1/thresholds': { ...SAMPLE_THRESHOLDS, pilot_frozen: false } });
    let body: Record<string, unknown> | null = null;
    let attempt = 0;
    await page.route('**/api/v1/thresholds', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill(json({ ...SAMPLE_THRESHOLDS, pilot_frozen: false }));
      body = r.request().postDataJSON();
      attempt += 1;
      if (attempt === 1) return r.fulfill(json(sampleError('writes_disabled', 'écritures désactivées : ADMIN_TOKEN n\'est pas configuré côté serveur'), 503));
      if (attempt === 2) return r.fulfill(json(sampleError('stale_policy_version', 'version attendue seuils-v2, version actuelle seuils-v3'), 409));
      return r.fulfill(json({ ...SAMPLE_THRESHOLDS, pilot_frozen: false, policy_version: 'seuils-v3', history: [{ ...SAMPLE_THRESHOLDS.history[0], id: 'T-2', policy_version: 'seuils-v3', key: 'anomaly_mad_k', label: 'Écart de détection d\'anomalie', from: 3, to: 2.5, reason: 'Essai de test serveur' }, ...SAMPLE_THRESHOLDS.history] }));
    });
    await goLive(page, '?territory=flanc-est', 'live', '#/reglages/seuils');
    await page.getByTestId('thr-anomaly_mad_k').fill('2.5');
    await page.getByTestId('thr-save').click();
    await page.getByTestId('thr-reason').fill('Essai de test serveur');
    await page.getByTestId('thr-ack').check();
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-error')).toContainText('désactivées côté serveur');
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-error')).toContainText('rechargez');
    await expect(page.getByRole('dialog')).toBeVisible(); // la boîte reste ouverte : rien n'est perdu
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-history')).toContainText('Essai de test serveur');
    expect(body).toMatchObject({ confirmed: true, reason: 'Essai de test serveur', expected_policy_version: 'seuils-v2', changes: [{ key: 'anomaly_mad_k', to: 2.5 }] });
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
    expect(await page.evaluate(() => JSON.stringify(window.__VEILLE__))).toBe('{}');
  });
  test('mode « mock » explicite = même comportement', async ({ page }) => {
    await goLive(page, '', 'mock');
    await expect(page.locator('.demo-bar')).toBeVisible();
  });
});
