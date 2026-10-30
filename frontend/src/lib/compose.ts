import type { Counters, DossierScenario, GaugeDetail, GaugeHistory, GaugeState, JournalEntry, ReviewItem, Snapshot, SourceRecord, Territory, ThresholdsState, VeilleEvent, ExclusionReason } from '../types';
import { eventId, normalizeSnapshot } from './normalize';

/** Réponses brutes des routes du backend, déjà validées par leurs schémas. `gauge`/`detail` null = `404 not_evaluated`. */
export interface Parts {
  territories: Territory[];
  gauge: GaugeState | null;
  detail: GaugeDetail | null;
  history: GaugeHistory;
  dossiers: DossierScenario[];
  events: VeilleEvent[];
  sources: SourceRecord[];
  thresholds: ThresholdsState;
  reviews: ReviewItem[];
  /** territoire demandé (utilisé si la jauge n'est pas encore évaluée) */
  territoryId: string;
  now: string;
}

function counters(events: VeilleEvent[]): Counters {
  const by: Record<ExclusionReason, number> = { doublon: 0, hors_perimetre: 0, perime: 0, preuve_insuffisante: 0 };
  events.forEach((e) => e.exclusion && (by[e.exclusion.reason] += 1));
  const docs = new Set(events.flatMap((e) => e.sources.map((s) => `${s.id}|${s.url}`)));
  return {
    documents_collected: docs.size,
    unique_events: events.filter((e) => e.exclusion?.reason !== 'doublon').length,
    excluded: events.filter((e) => e.exclusion).length,
    retained: events.filter((e) => !e.exclusion && e.reading_status === 'retenu').length,
    excluded_by_reason: by,
  };
}

/** Le journal complet n'existe pas encore côté serveur : on liste ce qui est réel (changements de seuils et de versions). */
function journalFrom(th: ThresholdsState): JournalEntry[] {
  return th.history.map((h) => ({
    id: `J-${h.id}`,
    at: h.at,
    kind: 'methode' as const,
    text: `${h.kind === 'retour_plan' ? 'Retour au plan' : 'Seuil'} « ${h.label} » : ${h.from} → ${h.to} (${h.policy_version}) — motif : ${h.reason} (${h.actor}). Historique moins comparable.`,
    simulated: false,
  }));
}

/**
 * Assemble l'instantané du dashboard à partir des VRAIES routes du backend (pas de /overview côté serveur).
 * Tout ce que le backend ne fournit pas encore est rendu EXPLICITEMENT absent (conclusion null, IA indisponible, journal partiel,
 * notifications en lecture seule) : jamais remplacé par une valeur plausible.
 */
export function composeSnapshot(p: Parts): Snapshot {
  const terr = p.territories.find((t) => t.id === p.territoryId) ?? p.territories.find((t) => t.default) ?? { id: p.territoryId, label: p.territoryId, zones: [], default: true };
  const notEvaluated = p.gauge === null || p.detail === null;
  const gauge: GaugeState =
    p.gauge ?? {
      territory: { id: terr.id, label: terr.label },
      status: 'non_calculable',
      palier: null,
      last_known: null,
      partial_coverage: false,
      as_of: p.now,
      trend_24h: { direction: 'non_comparable', from: null, to: null, reason: 'jauge non évaluée' },
      trend_7d: { direction: 'non_comparable', from: null, to: null, reason: 'jauge non évaluée' },
      policy: { version: p.thresholds.policy_version, plan_version: p.thresholds.plan_version, label: `Seuils ${p.thresholds.policy_version}` },
    };
  const coverage = p.detail?.coverage ?? {
    profile_satisfied: false,
    profile_label: 'Profil de couverture : non évalué',
    families: [],
    pending_documents: p.reviews.filter((r) => r.kind === 'unqualified_document').length,
    pending_major_review: 0,
    baseline: { sufficient: false, detail: 'La jauge n’a pas encore été évaluée pour ce territoire' },
    reasons: ['la jauge n’a pas encore été évaluée : attendre le prochain tour du worker'],
  };
  const lastSuccess = p.sources.map((s) => s.last_success).filter((x): x is string => !!x).sort().pop();
  const snap: Snapshot = {
    scenario_id: 'live',
    as_of: gauge.as_of,
    last_collect: lastSuccess ?? gauge.as_of,
    territories: p.territories,
    gauge,
    coverage,
    criteria: p.detail?.criteria ?? [],
    paliers: p.detail?.paliers,
    conclusion: null,
    hypotheses: [],
    events: p.events,
    counters: counters(p.events),
    dossiers: p.dossiers,
    history: p.history.points,
    method_changes: p.history.method_changes,
    sources: p.sources,
    reviews: p.reviews,
    journal: journalFrom(p.thresholds),
    journal_partial: true,
    civil_alert: null,
    nuclear: null,
    ai: {
      mode: 'desactivee',
      budget_exhausted: false,
      available: false,
      estimate: { max_cost_usd: 0, scope_current: '', scope_extended: '' },
      monthly_cap_usd: 0,
      monthly_used_usd: 0,
      previous_runs: [],
    },
    thresholds: p.thresholds,
    notifications: { enabled: false, silent_until_pilot_end: true, level: 'officiel_a3', channel: 'telegram', channel_state: 'non_active', editable: false },
    demo: false,
  };
  // `notEvaluated` : la couverture porte déjà la raison ; rien d'autre n'est inventé.
  void notEvaluated;
  void eventId;
  return normalizeSnapshot(snap);
}
