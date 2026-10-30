import { describe, expect, it } from 'vitest';
import { adjustGauge, applyChanges, modifiedItems, validate } from './thresholds';
import { buildSnapshot } from '../mocks/scenarios';

const base = () => buildSnapshot('nominal').thresholds;
const item = () => base().items.find((i) => i.key === 'anomaly_mad_k')!;

describe('seuils : garde-fous', () => {
  it('refuse hors limites, hors pas, vide ou non numérique', () => {
    expect(validate(item(), '9')).toMatch(/limites/);
    expect(validate(item(), '1')).toMatch(/limites/);
    expect(validate(item(), '2.7')).toMatch(/pas/);
    expect(validate(item(), '')).toBeTruthy();
    expect(validate(item(), 'abc')).toBeTruthy();
    expect(validate(item(), '2,5')).toBeNull();
  });
  it('chaque enregistrement crée une nouvelle version et conserve tout l’historique', () => {
    const a = applyChanges(base(), [{ key: 'anomaly_mad_k', to: 2.5 }], 'essai 1', '2026-10-29T15:31:00Z', 'modification');
    const b = applyChanges(a, [{ key: 'downgrade_evals', to: 1 }], 'essai 2', '2026-10-29T15:32:00Z', 'modification');
    expect(a.policy_version).toBe('seuils-v2');
    expect(b.policy_version).toBe('seuils-v3');
    expect(b.history).toHaveLength(2);
    expect(b.history[1]).toMatchObject({ key: 'anomaly_mad_k', from: 3, to: 2.5, reason: 'essai 1' });
    expect(base().history).toHaveLength(0); // l'état d'origine n'est pas muté
  });
  it('retour au plan = un changement daté de plus, pas un effacement', () => {
    const a = applyChanges(base(), [{ key: 'anomaly_mad_k', to: 2.5 }], 'essai', '2026-10-29T15:31:00Z', 'modification');
    const r = applyChanges(a, modifiedItems(a.items).map((i) => ({ key: i.key, to: i.plan_value })), 'retour', '2026-10-29T15:40:00Z', 'retour_plan');
    expect(modifiedItems(r.items)).toHaveLength(0);
    expect(r.history).toHaveLength(2);
    expect(r.history[0].kind).toBe('retour_plan');
  });
  it('la tendance devient non comparable après un changement récent, pas avant', () => {
    const g = buildSnapshot('nominal', 'flanc-est').gauge;
    const a = applyChanges(base(), [{ key: 'anomaly_mad_k', to: 2.5 }], 'essai', '2026-10-29T15:00:00Z', 'modification');
    const adj = adjustGauge(g, a.history, '2026-10-29T15:30:00Z');
    expect(adj.trend_24h.direction).toBe('non_comparable');
    expect(adj.trend_7d.direction).toBe('non_comparable');
    const old = adjustGauge(g, a.history, '2026-11-20T15:30:00Z');
    expect(old.trend_7d.direction).toBe(g.trend_7d.direction);
    expect(adjustGauge(g, [], g.as_of)).toBe(g);
  });
  it('les valeurs du plan du mock sont dans leurs limites', () => {
    for (const i of base().items) {
      expect(i.plan_value).toBeGreaterThanOrEqual(i.min);
      expect(i.plan_value).toBeLessThanOrEqual(i.max);
    }
  });
});
