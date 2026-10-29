/**
 * Types des réponses API attendues par le dashboard.
 * Documentés en prose dans docs/api-contract.md — les deux fichiers doivent rester alignés.
 * Toutes les dates sont des chaînes ISO 8601 en UTC ("2026-10-29T14:30:00Z").
 */

/** Les huit paliers conventionnels de la V1 (section 6.3 du plan). Jamais 43,7. */
export type Palier = 0 | 10 | 25 | 40 | 55 | 70 | 85 | 100;

export type Trend = 'hausse' | 'stable' | 'baisse' | 'non_comparable';

export interface GaugeState {
  /** Territoire évalué (distinct de la vue de la carte). */
  territory: { id: string; label: string };
  /** `calculable` : palier courant valide. `non_calculable` : couverture insuffisante → tiret. */
  status: 'calculable' | 'non_calculable';
  /** null si non calculable. */
  palier: Palier | null;
  /** Dernière valeur connue (affichée en secondaire, avec date, si non calculable). */
  last_known: { palier: Palier; at: string } | null;
  /** Fait grave établi malgré une couverture partielle : palier documenté + badge. */
  partial_coverage: boolean;
  as_of: string;
  /** Tendance 24 h et 7 j, « stable » = même palier. `from`/`to` servent à dire « passage du palier 25 au palier 40 ». */
  trend_24h: TrendInfo;
  trend_7d: TrendInfo;
  policy: { version: string; label: string };
}

export interface TrendInfo {
  direction: Trend;
  from: Palier | null;
  to: Palier | null;
  /** Raison lorsque `non_comparable` (changement de méthode, couverture différente…). */
  reason?: string;
}

export interface CoverageFamily {
  id: string;
  label: string;
  state: 'ok' | 'degrade' | 'indisponible';
  detail: string;
}

export interface Coverage {
  /** Le profil de couverture du territoire est-il satisfait ? */
  profile_satisfied: boolean;
  profile_label: string;
  families: CoverageFamily[];
  pending_documents: number;
  pending_major_review: number;
  baseline: { sufficient: boolean; detail: string };
}

export type HypothesisId = 'H0' | 'H1' | 'H2' | 'H3' | 'H4';
export type HypothesisVerdict = 'soutenue' | 'compatible' | 'contredite' | 'donnees_insuffisantes';

export interface Hypothesis {
  id: HypothesisId;
  label: string;
  verdict: HypothesisVerdict;
  supports: string[];
  contradicts: string[];
  missing: string[];
  evidence_ids: string[];
}

/** Conclusion « à gabarit » : le front assemble la phrase, chaque proposition renvoie à des événements. */
export interface Conclusion {
  template_version: string;
  /** Hypothèse dominante ou constat ; null → « plusieurs interprétations restent possibles ». */
  orientation: { text: string; hypothesis_id: HypothesisId | null } | null;
  evidence_ids: string[];
  trend: { period: string; direction: Trend };
  alternative: { text: string; missing_discriminant: string } | null;
  ambiguous: boolean;
  /** Renseigné quand la conclusion est suspendue (indice non calculable, changement de méthode…). */
  suspended_reason?: string;
}

export type SourceKind = 'mesure' | 'operateur' | 'autorite' | 'media';
export type ReadingStatus = 'retenu' | 'contexte' | 'a_verifier';
export type ExclusionReason = 'doublon' | 'hors_perimetre' | 'perime' | 'preuve_insuffisante';
export type LayerId = 'restrictions' | 'aviation' | 'reseaux' | 'incidents' | 'mesures' | 'satellite';

export interface EventSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** Statut officiel de la source : séparé du statut de lecture. */
  official: boolean;
  published_at: string | null;
  retrieved_at: string;
  /** Lien vers l'original (non cliquable en maquette). */
  url: string;
  excerpt: string;
  /** Chaîne de reprises : plusieurs reprises d'une même origine ne sont pas indépendantes. */
  origin_id: string;
  is_original: boolean;
}

export type LocationPrecision = 'pays' | 'region' | 'indicatif';

export type EventLocation =
  | { kind: 'point'; lon: number; lat: number; precision: LocationPrecision; label: string; iso?: string }
  | { kind: 'none'; reason: string };

export interface CriterionEffect {
  palier: Palier;
  criterion: string;
  /** « critère rempli / non rempli » — jamais des points ajoutés. */
  state: 'rempli' | 'non_rempli' | 'non_evalue';
  note: string;
}

export interface VeilleEvent {
  id: string;
  title: string;
  layer: LayerId;
  fictional: true;
  reading_status: ReadingStatus;
  /** Raison d'exclusion si l'événement est exclu de l'analyse (inspectable). */
  exclusion: { reason: ExclusionReason; detail: string } | null;
  /** Statut de preuve (affiché à part du statut de lecture). */
  evidence_status: 'directe' | 'deux_origines' | 'origine_unique' | 'non_corroboree';
  occurred_at: string | null;
  occurred_precision: 'minute' | 'heure' | 'jour' | 'inconnue';
  published_at: string | null;
  first_seen_at: string;
  retrieved_at: string;
  expires_at: string | null;
  location: EventLocation;
  observed_fact: string;
  hypotheses: string[];
  contradictions: string[];
  rule: { id: string; version: string };
  effect: CriterionEffect;
  sources: EventSource[];
  /** Compte des reprises uniques : indépendance des origines. */
  independent_origins: number;
  /** Dossiers auxquels cet événement est rattaché. */
  dossier_ids: string[];
}

export interface Counters {
  documents_collected: number;
  unique_events: number;
  excluded: number;
  retained: number;
  excluded_by_reason: Record<ExclusionReason, number>;
}

export interface DossierScenario {
  id: string;
  title: string;
  zone: string;
  horizon: string;
  /** « indéterminé » est une valeur admise. */
  state: 'actif' | 'indetermine' | 'veille';
  summary: string;
  rules_version: string;
  rule_interpretation: {
    conclusion: string;
    supports: string[];
    contradicts: string[];
    missing: string[];
    hypotheses: Hypothesis[];
  };
  event_ids: string[];
  updated_at: string;
}

export interface HistoryPoint {
  at: string;
  /** null = intervalle sans mesure : la courbe est interrompue, jamais remplacée par 0. */
  palier: Palier | null;
  /** Identifiant de la version de méthode appliquée. */
  policy_version: string;
}

export interface MethodChange {
  at: string;
  from_version: string;
  to_version: string;
  note: string;
  /** `recalcule` : historique recalculé explicitement sous la même règle ; `suspendue` : tendance suspendue. */
  handling: 'tendance_suspendue' | 'historique_recalcule';
}

export type SourceHealthState = 'ok' | 'retard' | 'indisponible';

export interface SourceRecord {
  id: string;
  name: string;
  organism: string;
  kind: SourceKind;
  family: string;
  zone: string;
  access: string;
  expected_delay: string;
  frequency: string;
  state: SourceHealthState;
  state_detail: string;
  last_success: string | null;
  last_novelty: string | null;
  licence: string;
}

export interface JournalEntry {
  id: string;
  at: string;
  kind: 'palier' | 'methode' | 'source' | 'evenement' | 'notification' | 'revue';
  text: string;
  /** Jamais de notification réelle en maquette. */
  simulated: boolean;
}

export interface CivilAlert {
  title: string;
  detail: string;
  issuer: string;
  /** Lien vers la consigne officielle (non cliquable en maquette). */
  instruction_url: string;
  since: string;
}

export type NuclearKind = 'discours' | 'exercice' | 'alerte_radiologique' | 'emploi_confirme';

export interface NuclearBadge {
  kind: NuclearKind;
  scope: string;
  source: string;
  status: string;
  instructions: string;
}

export type AiMode = 'desactivee' | 'a_la_demande' | 'automatique';

export interface AiState {
  mode: AiMode;
  budget_exhausted: boolean;
  /** Estimation affichée avant confirmation. */
  estimate: { max_cost_usd: number; scope_current: string; scope_extended: string };
  monthly_cap_usd: number;
  monthly_used_usd: number;
  /** Analyses précédentes : l'avis IA n'efface jamais le précédent. */
  previous_runs: { at: string; model: string; agreement_with_rules: 'accord' | 'desaccord_partiel' | 'desaccord'; summary: string }[];
}

export interface Snapshot {
  scenario_id: string;
  as_of: string;
  last_collect: string;
  gauge: GaugeState;
  coverage: Coverage;
  conclusion: Conclusion;
  hypotheses: Hypothesis[];
  events: VeilleEvent[];
  counters: Counters;
  dossiers: DossierScenario[];
  history: HistoryPoint[];
  method_changes: MethodChange[];
  sources: SourceRecord[];
  journal: JournalEntry[];
  civil_alert: CivilAlert | null;
  nuclear: NuclearBadge | null;
  ai: AiState;
  /** Mode maquette : bandeau permanent « Données fictives — maquette ». */
  demo: boolean;
}

/** Événements SSE (`GET /api/v1/stream`). */
export type StreamMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'event.upserted'; data: VeilleEvent }
  | { type: 'source.health'; data: SourceRecord }
  | { type: 'gauge.updated'; data: GaugeState };
