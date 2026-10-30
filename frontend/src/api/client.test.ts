import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, httpClient, resolveMode } from './client';
import { applyStream } from '../lib/stream';
import { buildSnapshot } from '../mocks/scenarios';

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

describe('client HTTP : erreurs explicites', () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = httpClient('');
  it('réseau coupé → ApiError sans statut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(client.load()).rejects.toMatchObject({ status: null, url: '/api/v1/overview?territory=FR' });
  });
  it('502/503/504 → l’API ne répond pas derrière le relais', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));
    await expect(client.load()).rejects.toThrow(/ne répond pas.*502/);
  });
  it('réponse non JSON (page d’accueil renvoyée à la place de l’API) → erreur lisible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 })));
    const e = await client.load().catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toMatch(/illisible/);
  });
  it('toutes les requêtes restent sur la même origine (chemins relatifs)', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
    vi.stubGlobal('fetch', f);
    const t = buildSnapshot('nominal').thresholds;
    await client.load();
    await client.saveThresholds(t, [{ key: 'anomaly_mad_k', to: 2.5 }], 'motif de test');
    await client.resetThresholds(t, 'motif de test');
    await client.saveNotifications(buildSnapshot('nominal').notifications);
    for (const [url] of f.mock.calls) expect(String(url)).toMatch(/^\/api\/v1\//);
    const put = f.mock.calls.find(([u]) => String(u).endsWith('/thresholds'))!;
    expect(JSON.parse(put[1].body)).toMatchObject({ confirmed: true, reason: 'motif de test', expected_policy_version: 'seuils-v1' });
  });
});

describe('flux SSE', () => {
  const s = buildSnapshot('nominal');
  it('event.upserted ajoute ou remplace sans toucher au reste', () => {
    const e = { ...s.events[0], title: 'modifié' };
    expect(applyStream(s, { type: 'event.upserted', data: e }).events[0].title).toBe('modifié');
    expect(applyStream(s, { type: 'event.upserted', data: { ...e, id: 'EV-999' } }).events).toHaveLength(s.events.length + 1);
  });
  it('gauge.updated, source.health et snapshot', () => {
    expect(applyStream(s, { type: 'gauge.updated', data: { ...s.gauge, palier: 55 } }).gauge.palier).toBe(55);
    expect(applyStream(s, { type: 'source.health', data: { ...s.sources[0], state: 'indisponible' } }).sources[0].state).toBe('indisponible');
    expect(applyStream(s, { type: 'snapshot', data: buildSnapshot('civile') }).civil_alert).not.toBeNull();
  });
});
