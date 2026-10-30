import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, httpClient, resolveMode } from './client';
import { applyStream } from '../lib/stream';
import { buildSnapshot } from '../mocks/scenarios';
import { backendRoutes, SAMPLE_NOT_EVALUATED, sampleError } from '../mocks/backend-samples';

describe('choix du mode d’API', () => {
  it('mock par défaut ou explicite, live explicite', () => {
    expect(resolveMode(undefined)).toEqual({ mode: 'mock', invalid: null });
    expect(resolveMode('')).toEqual({ mode: 'mock', invalid: null });
    expect(resolveMode('MOCK')).toEqual({ mode: 'mock', invalid: null });
    expect(resolveMode('live')).toEqual({ mode: 'live', invalid: null });
  });
  it('une valeur inconnue est une erreur de configuration, jamais un repli sur les données fictives', () => {
    const r = resolveMode('prod');
    expect(r.invalid).toBe('prod');
    expect(r.mode).toBe('live');
  });
});

/** Simule le backend : chemin → réponse JSON (statut 200 par défaut). */
function stubBackend(routes: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
    const u = new URL(input, 'http://x');
    calls.push({ url: u.pathname + u.search, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!(u.pathname in routes)) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(routes[u.pathname]), { status: status[u.pathname] ?? 200, headers: { 'Content-Type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

describe('client HTTP : routes réelles du backend, erreurs explicites', () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = httpClient('');

  it('compose l’instantané à partir des routes existantes, toutes en même origine, sans /overview', async () => {
    const calls = stubBackend(backendRoutes());
    const snap = await client.load({ territory: 'flanc-est' });
    const paths = calls.map((c) => c.url.split('?')[0]);
    expect(paths).toEqual(expect.arrayContaining(['/api/v1/territories', '/api/v1/gauge', '/api/v1/gauge/detail', '/api/v1/gauge/history', '/api/v1/dossiers', '/api/v1/events', '/api/v1/sources/status', '/api/v1/thresholds', '/api/v1/reviews']));
    expect(paths).not.toContain('/api/v1/overview');
    expect(calls.every((c) => c.url.startsWith('/api/v1/') && c.method === 'GET')).toBe(true);
    expect(calls.find((c) => c.url.startsWith('/api/v1/gauge?'))!.url).toContain('territory=flanc-est');
    expect(calls.find((c) => c.url.startsWith('/api/v1/events'))!.url).toContain('include_excluded=true');
    expect(snap.gauge.territory.id).toBe('flanc-est');
    expect(snap.demo).toBe(false);
  });
  it('sans territoire demandé : le territoire par défaut du serveur (FR) est utilisé', async () => {
    const calls = stubBackend(backendRoutes());
    await client.load();
    expect(calls.find((c) => c.url.startsWith('/api/v1/gauge?'))!.url).toContain('territory=FR');
  });
  it('404 not_evaluated : jauge non calculable explicite, pas une panne', async () => {
    stubBackend(backendRoutes({ '/api/v1/gauge': SAMPLE_NOT_EVALUATED, '/api/v1/gauge/detail': SAMPLE_NOT_EVALUATED, '/api/v1/dossiers': SAMPLE_NOT_EVALUATED }), {
      '/api/v1/gauge': 404,
      '/api/v1/gauge/detail': 404,
      '/api/v1/dossiers': 404,
    });
    const snap = await client.load({ territory: 'flanc-est' });
    expect(snap.gauge.status).toBe('non_calculable');
    expect(snap.gauge.palier).toBeNull();
    expect(snap.dossiers).toEqual([]);
  });
  it('réseau coupé → ApiError sans statut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(client.load()).rejects.toMatchObject({ status: null, url: '/api/v1/territories' });
  });
  it('502/503/504 → l’API ne répond pas derrière le relais', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));
    await expect(client.load()).rejects.toThrow(/ne répond pas.*502/);
  });
  it('réponse non JSON (page d’accueil renvoyée à la place de l’API) → erreur lisible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<html></html>', { status: 200 }))));
    const e = await client.load().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/illisible/);
  });
  it('dérive du contrat : message avec le chemin du champ fautif, aucun affichage', async () => {
    stubBackend(backendRoutes({ '/api/v1/gauge': { ...backendRoutes()['/api/v1/gauge' as never] as object, palier: 43 } }));
    const e = await client.load({ territory: 'flanc-est' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('contract_mismatch');
    expect(e.message).toMatch(/palier/);
  });
});

describe('écritures de seuils', () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = httpClient('');
  const th = buildSnapshot('nominal').thresholds;
  const okState = backendRoutes()['/api/v1/thresholds' as never];

  it('PUT et POST : corps conforme au backend, même origine', async () => {
    const calls = stubBackend({ '/api/v1/thresholds': okState, '/api/v1/thresholds/reset': okState });
    await client.saveThresholds(th, [{ key: 'events_for_40', to: 3 }], 'essai de sensibilité');
    await client.resetThresholds(th, 'retour aux valeurs du plan');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/v1/thresholds', body: { changes: [{ key: 'events_for_40', to: 3 }], reason: 'essai de sensibilité', confirmed: true, expected_policy_version: 'seuils-v1' } });
    expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/thresholds/reset', body: { reason: 'retour aux valeurs du plan', confirmed: true } });
    expect(calls.every((c) => c.url.startsWith('/api/v1/'))).toBe(true);
  });
  it.each([
    [503, 'writes_disabled', /désactivées côté serveur/],
    [401, 'unauthorized', /Jeton/],
    [409, 'stale_policy_version', /rechargez/],
    [422, 'out_of_bounds', /doit rester entre/],
  ])('erreur %i %s : message lisible tiré du corps {"error":{code,message}}', async (status, code, re) => {
    stubBackend({ '/api/v1/thresholds': sampleError(code, '« events_for_40 » doit rester entre 2 et 5 événements') }, { '/api/v1/thresholds': status });
    const e = await client.saveThresholds(th, [{ key: 'events_for_40', to: 99 }], 'essai de sensibilité').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    expect(e.message).toMatch(re);
  });
  it('notifications : pas de route serveur, refus explicite (jamais un succès simulé)', async () => {
    const e = await client.saveNotifications(buildSnapshot('nominal').notifications).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('not_implemented');
  });
});

describe('flux SSE', () => {
  const s = buildSnapshot('nominal', 'flanc-est');
  it('event.upserted ajoute ou remplace sans toucher au reste', () => {
    const e = { ...s.events[0], title: 'modifié' };
    expect(applyStream(s, { type: 'event.upserted', data: e }).events[0].title).toBe('modifié');
    expect(applyStream(s, { type: 'event.upserted', data: { ...e, id: 'EV-999' } }).events).toHaveLength(s.events.length + 1);
  });
  it('gauge.updated, source.health et snapshot', () => {
    expect(applyStream(s, { type: 'gauge.updated', data: { ...s.gauge, palier: 55 } }).gauge.palier).toBe(55);
    expect(applyStream(s, { type: 'source.health', data: { ...s.sources[0], state: 'indisponible' } }).sources[0].state).toBe('indisponible');
    expect(applyStream(s, { type: 'snapshot', data: buildSnapshot('civile', 'FR') }).civil_alert).not.toBeNull();
  });
});
