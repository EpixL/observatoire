import { describe, expect, it } from 'vitest';
import {
  GaugeDetailSchema,
  GaugeHistorySchema,
  GaugeStateSchema,
  DossierScenarioSchema,
  ReviewItemSchema,
  SnapshotSchema,
  SourceRecordSchema,
  TerritorySchema,
  ThresholdsStateSchema,
  VeilleEventSchema,
} from './schema';
import { z } from 'zod';
import { buildSnapshot, SCENARIOS, TERRITORIES } from './mocks/scenarios';
import * as S from './mocks/backend-samples';
import { composeSnapshot } from './lib/compose';
import { normalizeEvent, normalizeSnapshot } from './lib/normalize';
import type { VeilleEvent } from './types';

const issues = (r: { success: boolean; error?: z.ZodError }) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

describe('fixtures du mode maquette valides contre les types partagés (schémas zod)', () => {
  for (const sc of SCENARIOS) {
    for (const t of TERRITORIES) {
      it(`${sc.id} × ${t.id}`, () => {
        expect(issues(SnapshotSchema.safeParse(buildSnapshot(sc.id, t.id)))).toEqual([]);
        expect(issues(SnapshotSchema.safeParse(normalizeSnapshot(buildSnapshot(sc.id, t.id))))).toEqual([]);
      });
    }
  }
  it('ids d’événements au format réel EV-<n>, ids entiers dans les dossiers (comme le backend)', () => {
    const s = buildSnapshot('nominal', 'flanc-est');
    expect(s.events.every((e) => /^EV-\d+$/.test(e.id))).toBe(true);
    expect(s.dossiers.every((d) => d.event_ids.every((i) => typeof i === 'number'))).toBe(true);
    expect(s.events.every((e) => e.dossier_ids.length === 0)).toBe(true); // complétés par la normalisation, pas par le « serveur »
  });
  it('la jauge de la maquette porte la version de seuils comme le backend (policy.version = seuils-vN)', () => {
    for (const sc of SCENARIOS) expect(buildSnapshot(sc.id).gauge.policy.version).toMatch(/^seuils-v\d+$/);
  });
  it('les 11 seuils de la maquette sont ceux du backend (clés, bornes, valeur du plan dans les bornes)', () => {
    const items = buildSnapshot('nominal').thresholds.items;
    expect(items.map((i) => i.key)).toEqual([
      'anomaly_mad_k', 'anomaly_windows', 'origins_for_25', 'events_for_40', 'families_for_40', 'downgrade_evals',
      'weak_signal_expiry_h', 'coverage_families', 'baseline_weeks', 'convergence_window_h', 'coverage_freshness_h',
    ]);
    for (const i of items) expect(i.plan_value >= i.min && i.plan_value <= i.max).toBe(true);
  });
});

describe('échantillons de forme réelle du backend (commit 133aace) acceptés par les schémas', () => {
  it('chaque route', () => {
    expect(issues(z.array(TerritorySchema).safeParse(S.SAMPLE_TERRITORIES))).toEqual([]);
    expect(issues(GaugeStateSchema.safeParse(S.SAMPLE_GAUGE))).toEqual([]);
    expect(issues(GaugeDetailSchema.safeParse(S.SAMPLE_DETAIL))).toEqual([]);
    expect(issues(GaugeHistorySchema.safeParse(S.SAMPLE_HISTORY))).toEqual([]);
    expect(issues(z.array(DossierScenarioSchema).safeParse(S.SAMPLE_DOSSIERS))).toEqual([]);
    expect(issues(z.array(VeilleEventSchema).safeParse(S.SAMPLE_EVENTS))).toEqual([]);
    expect(issues(z.array(SourceRecordSchema).safeParse(S.SAMPLE_SOURCES))).toEqual([]);
    expect(issues(ThresholdsStateSchema.safeParse(S.SAMPLE_THRESHOLDS))).toEqual([]);
    expect(issues(z.array(ReviewItemSchema).safeParse(S.SAMPLE_REVIEWS))).toEqual([]);
  });
  it('une réponse qui s’écarte du contrat est refusée avec le chemin fautif', () => {
    const bad = { ...S.SAMPLE_GAUGE, palier: 43 };
    expect(issues(GaugeStateSchema.safeParse(bad)).join()).toMatch(/palier/);
    const bad2 = { ...S.SAMPLE_SOURCES[0], verdict: 'WARN' };
    expect(issues(SourceRecordSchema.safeParse(bad2)).join()).toMatch(/verdict/);
    const bad3 = { ...S.SAMPLE_EVENTS[0], occurred_precision: 'minute' }; // ancien vocabulaire du dashboard
    expect(issues(VeilleEventSchema.safeParse(bad3)).join()).toMatch(/occurred_precision/);
  });
  it('les 11 clés de seuils de l’échantillon sont celles de la maquette', () => {
    expect(S.SAMPLE_THRESHOLDS.items.map((i) => i.key)).toEqual(buildSnapshot('nominal').thresholds.items.map((i) => i.key));
  });
});

describe('composition à partir des routes du backend', () => {
  const parts = () => ({
    territories: z.array(TerritorySchema).parse(S.SAMPLE_TERRITORIES),
    gauge: GaugeStateSchema.parse(S.SAMPLE_GAUGE),
    detail: GaugeDetailSchema.parse(S.SAMPLE_DETAIL),
    history: GaugeHistorySchema.parse(S.SAMPLE_HISTORY),
    dossiers: z.array(DossierScenarioSchema).parse(S.SAMPLE_DOSSIERS),
    events: z.array(VeilleEventSchema).parse(S.SAMPLE_EVENTS),
    sources: z.array(SourceRecordSchema).parse(S.SAMPLE_SOURCES),
    thresholds: ThresholdsStateSchema.parse(S.SAMPLE_THRESHOLDS),
    reviews: z.array(ReviewItemSchema).parse(S.SAMPLE_REVIEWS),
    territoryId: 'flanc-est',
    now: '2026-10-30T10:00:00Z',
  });
  it('produit un instantané valide, réel (demo=false), sans rien inventer', () => {
    const snap = composeSnapshot(parts());
    expect(issues(SnapshotSchema.safeParse(snap))).toEqual([]);
    expect(snap.demo).toBe(false);
    expect(snap.conclusion).toBeNull(); // moteur d'hypothèses absent : aucune phrase fabriquée
    expect(snap.hypotheses).toEqual([]);
    expect(snap.civil_alert).toBeNull();
    expect(snap.nuclear).toBeNull();
    expect(snap.journal_partial).toBe(true);
    expect(snap.ai.available).toBe(false);
    expect(snap.notifications.editable).toBe(false);
    expect(snap.thresholds.pilot_frozen).toBeUndefined(); // absent côté backend : le dashboard l'interprète « gelé »
  });
  it('normalise : ids d’événements des dossiers/critères, dossier_ids, nom de zone', () => {
    const snap = composeSnapshot(parts());
    expect(snap.dossiers[0].event_ids).toEqual(['EV-3']);
    expect(snap.criteria.find((c) => c.palier === 25)!.event_ids).toEqual(['EV-3']);
    const ev = snap.events.find((e) => e.id === 'EV-3')!;
    expect(ev.dossier_ids).toEqual(['D-CIV']);
    expect(ev.location.kind === 'point' && ev.location.label).toBe('Lituanie — position indicative (échelle pays)');
  });
  it('jauge non évaluée (404 not_evaluated) : état explicite non calculable, jamais 0', () => {
    const snap = composeSnapshot({ ...parts(), gauge: null, detail: null, dossiers: [] });
    expect(snap.gauge.status).toBe('non_calculable');
    expect(snap.gauge.palier).toBeNull();
    expect(snap.coverage.reasons.join()).toMatch(/pas encore été évaluée/);
    expect(issues(SnapshotSchema.safeParse(snap))).toEqual([]);
  });
  it('compteurs dérivés des événements réels', () => {
    const snap = composeSnapshot(parts());
    expect(snap.counters.excluded).toBe(1);
    expect(snap.counters.excluded_by_reason.perime).toBe(1);
    expect(snap.counters.retained).toBe(1);
  });
});

describe('normalisation d’affichage', () => {
  const base = (over: Partial<VeilleEvent>) => normalizeEvent({ ...(S.SAMPLE_EVENTS[0] as unknown as VeilleEvent), ...over });
  it('le nom de zone vient du code (le backend n’envoie que le code)', () => {
    const e = base({ zone_code: 'PL', location: { kind: 'point', lon: 19.4, lat: 52.1, precision: 'pays', label: 'PL', iso: 'PL' } });
    expect(e.location.kind === 'point' && e.location.label).toBe('Pologne — position indicative (échelle pays)');
  });
  it('Russie : posée sur l’ouest du pays, échelle région (décision de David), pas en Sibérie', () => {
    const e = base({ zone_code: 'RU', location: { kind: 'point', lon: 95, lat: 61, precision: 'pays', label: 'RU', iso: 'RU' } });
    expect(e.location.kind === 'point' && [e.location.lon, e.location.lat, e.location.precision]).toEqual([38, 56, 'region']);
  });
  it('outre-mer : place_code place le marqueur sur le territoire ; sans lui, centre de la France (backend actuel)', () => {
    const fr = { kind: 'point' as const, lon: 2.3, lat: 46.6, precision: 'pays' as const, label: 'FR', iso: 'FR' };
    const withCode = base({ zone_code: 'FR', place_code: 'NC', location: fr });
    expect(withCode.location.kind === 'point' && [withCode.location.lon, withCode.location.lat]).toEqual([165.6, -21.3]);
    const without = base({ zone_code: 'FR', location: fr });
    expect(without.location.kind === 'point' && [without.location.lon, without.location.lat]).toEqual([2.3, 46.6]);
  });
  it('idempotente', () => {
    const s = normalizeSnapshot(buildSnapshot('nominal', 'flanc-est'));
    expect(normalizeSnapshot(s)).toEqual(s);
  });
});
