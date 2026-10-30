import type { GaugeState, ThresholdChange, ThresholdItem, ThresholdsState } from '../types';
import { fmt } from './format';

export const COMPARABILITY_SENTENCE =
  'Changer un seuil change la façon dont les paliers sont calculés : les valeurs d’avant et d’après ne reposent plus sur les mêmes règles, l’historique et la tendance deviennent donc moins comparables.';

export const modifiedItems = (items: ThresholdItem[]) => items.filter((i) => i.value !== i.plan_value);

export function validate(item: ThresholdItem, raw: string): string | null {
  const v = Number(raw.replace(',', '.'));
  if (raw.trim() === '' || Number.isNaN(v)) return 'Saisir un nombre.';
  if (v < item.min || v > item.max) return `Valeur hors des limites de sécurité (${item.min} à ${item.max}).`;
  const steps = (v - item.min) / item.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return `Par pas de ${item.step}.`;
  return null;
}

/** Applique des changements : une nouvelle version de politique par enregistrement ; l'historique n'est jamais écrasé ni supprimé. */
export function applyChanges(
  state: ThresholdsState,
  changes: { key: string; to: number }[],
  reason: string,
  at: string,
  kind: ThresholdChange['kind'],
  actor = 'David (maquette)',
): ThresholdsState {
  const n = Number(state.policy_version.replace('seuils-v', '')) + 1;
  const version = `seuils-v${n}`;
  const items = state.items.map((i) => {
    const c = changes.find((x) => x.key === i.key);
    return c ? { ...i, value: c.to } : i;
  });
  const entries: ThresholdChange[] = changes.map((c, idx) => {
    const item = state.items.find((i) => i.key === c.key)!;
    return { id: `T-${state.history.length + idx + 1}`, at, kind, key: c.key, label: item.label, from: item.value, to: c.to, reason, actor, policy_version: version };
  });
  return { ...state, policy_version: version, items, history: [...entries.reverse(), ...state.history] };
}

/**
 * Après un changement de seuil, la tendance n'est plus comparable sur la période concernée :
 * on le dit au lieu de présenter une variation due à la méthode comme une évolution réelle.
 */
export function adjustGauge(g: GaugeState, history: ThresholdChange[], asOf: string): GaugeState {
  const last = history.map((h) => h.at).sort().pop();
  if (!last) return g;
  const age = Date.parse(asOf) - Date.parse(last);
  const reason = `seuils modifiés le ${fmt(last)}`;
  const non = (t: GaugeState['trend_24h']): GaugeState['trend_24h'] => ({ direction: 'non_comparable', from: null, to: null, reason: t.reason ?? reason });
  return {
    ...g,
    trend_24h: age <= 24 * 3_600_000 ? non(g.trend_24h) : g.trend_24h,
    trend_7d: age <= 7 * 24 * 3_600_000 ? non(g.trend_7d) : g.trend_7d,
  };
}
