import { describe, expect, it } from 'vitest';
import { PALIERS, PALIER_VALUES, palierAngle, palierTone, trendSentence } from './scale';
import { stepPaths, toSegments } from './history';
import { applyFilters, DEFAULT_FILTERS } from './filters';
import { buildSnapshot, SCENARIOS, storyTerritoryOf } from '../mocks/scenarios';
import type { HistoryPoint } from '../types';

describe('échelle', () => {
  it('compte exactement les huit paliers du plan', () => {
    expect(PALIER_VALUES).toEqual([0, 10, 25, 40, 55, 70, 85, 100]);
    expect(PALIERS.every((p) => p.label && p.criteria)).toBe(true);
  });
  it('le cadran couvre 270° sans dépasser', () => {
    expect(palierAngle(0)).toBe(-135);
    expect(palierAngle(100)).toBe(135);
  });
  it('le rouge est réservé aux paliers ≥ 70 ; neutre quand non calculable', () => {
    expect(palierTone(55)).toBe('watch');
    expect(palierTone(70)).toBe('grave');
    expect(palierTone(null)).toBe('neutral');
  });
  it('dit « passage du palier X au palier Y », jamais un pourcentage', () => {
    const s = trendSentence({ direction: 'hausse', from: 25, to: 40 }, '7 jours');
    expect(s).toContain('passage du palier 25 au palier 40');
    expect(s).not.toContain('%');
  });
});

const pt = (h: number, p: HistoryPoint['palier']): HistoryPoint => ({ at: new Date(Date.UTC(2026, 9, 1, h)).toISOString(), palier: p, policy_version: 'v' });

describe('historique en escalier', () => {
  const x = (iso: string) => (Date.parse(iso) - Date.UTC(2026, 9, 1)) / 3_600_000;
  const y = (v: number) => 100 - v;
  it("n'interpole jamais : que des segments horizontaux et verticaux", () => {
    const [d] = stepPaths([pt(0, 0), pt(6, 0), pt(12, 25), pt(18, 25)], x, y);
    expect(d).toBe('M 0.0 100.0 H 6.0 H 12.0 V 75.0 H 18.0');
    expect(d).not.toMatch(/ L /);
  });
  it('interrompt le tracé sur un intervalle sans mesure au lieu de le remplacer par 0', () => {
    const paths = stepPaths([pt(0, 10), pt(6, 10), pt(12, null), pt(18, 25)], x, y);
    expect(paths).toHaveLength(2);
    expect(toSegments([pt(0, 10), pt(6, null), pt(12, null)])).toHaveLength(2);
  });
});

describe('scénarios fictifs', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s : cohérent et marqué fictif', (id) => {
    const s = buildSnapshot(id, storyTerritoryOf(id));
    expect(s.demo).toBe(true);
    expect(s.events.every((e) => e.fictional)).toBe(true);
    // jamais de coordonnées « précises » : toute position est indicative
    expect(s.events.every((e) => e.location.kind === 'none' || ['pays', 'region', 'indicatif'].includes(e.location.precision))).toBe(true);
    // le territoire ne contient que ses zones (une attaque en Ukraine n'est pas une attaque en France)
    const terr = s.territories.find((t) => t.id === s.gauge.territory.id)!;
    expect(s.events.every((e) => e.zone_code == null || terr.zones.includes(e.zone_code))).toBe(true);
    // non calculable ⇒ pas de palier courant, jamais 0 par défaut
    if (s.gauge.status === 'non_calculable') expect(s.gauge.palier).toBeNull();
    else expect(PALIER_VALUES).toContain(s.gauge.palier);
    expect(s.counters.unique_events).toBeGreaterThan(0);
  });
  it('les filtres ne retirent que de l’affichage (aucune mutation)', () => {
    const s = buildSnapshot('nominal', 'flanc-est');
    const n = s.events.length;
    const f = applyFilters(s.events, { ...DEFAULT_FILTERS, layers: new Set(['restrictions']) }, s.as_of);
    expect(f.every((e) => e.layer === 'restrictions')).toBe(true);
    expect(s.events).toHaveLength(n);
  });
  it('une reprise de la même dépêche ne compte pas comme origine indépendante', () => {
    const e = buildSnapshot('nominal', 'flanc-est').events.find((x) => x.id === 'EV-5')!;
    expect(e.sources).toHaveLength(3);
    expect(new Set(e.sources.map((s) => s.origin_id)).size).toBe(1);
    expect(e.independent_origins).toBe(1);
  });
});
