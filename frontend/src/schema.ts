/**
 * SOURCE UNIQUE du contrat de données du dashboard : schémas zod, dont les types TypeScript (types.ts) sont déduits.
 * Ils servent à trois choses :
 *   1. typer tout le code ;
 *   2. valider les fixtures du mode maquette (src/schema.test.ts) ;
 *   3. valider chaque réponse de l'API réelle (mode live) : une dérive du contrat devient une erreur lisible, pas un affichage faux.
 * Le backend fait foi pour les noms et les formes (docs/api-contract-backend-proposal.md, branche `backend`).
 * Dates : ISO 8601 UTC (« …Z » ou « …+00:00 »).
 */
import { z } from 'zod';

const Iso = z.string().min(10);
const IsoOrNull = Iso.nullable();

/** Les huit paliers conventionnels (plan §6.3). Jamais 43,7. */
export const PalierSchema = z.union([z.literal(0), z.literal(10), z.literal(25), z.literal(40), z.literal(55), z.literal(70), z.literal(85), z.literal(100)]);
export const TrendSchema = z.enum(['hausse', 'stable', 'baisse', 'non_comparable']);

export const TrendInfoSchema = z.object({
  direction: TrendSchema,
  from: PalierSchema.nullable(),
  to: PalierSchema.nullable(),
  reason: z.string().optional(),
});

export const GaugeStateSchema = z.object({
  territory: z.object({ id: z.string(), label: z.string() }),
  status: z.enum(['calculable', 'non_calculable']),
  palier: PalierSchema.nullable(),
  last_known: z.object({ palier: PalierSchema, at: Iso }).nullable(),
  partial_coverage: z.boolean(),
  as_of: Iso,
  trend_24h: TrendInfoSchema,
  trend_7d: TrendInfoSchema,
  policy: z.object({ version: z.string(), plan_version: z.string(), label: z.string() }),
  rule_id: z.string().optional(),
  rules_version: z.string().nullable().optional(),
});

export const TerritorySchema = z.object({ id: z.string(), label: z.string(), zones: z.array(z.string()), default: z.boolean() });

/* ---------- couverture, critères ---------- */

export const CoverageFamilySchema = z.object({ id: z.string(), label: z.string(), state: z.enum(['ok', 'degrade', 'indisponible']), detail: z.string() });
export const CoverageSchema = z.object({
  profile_satisfied: z.boolean(),
  profile_label: z.string(),
  families: z.array(CoverageFamilySchema),
  pending_documents: z.number(),
  pending_major_review: z.number(),
  baseline: z.object({ sufficient: z.boolean(), detail: z.string() }),
  /** Pourquoi la couverture est insuffisante (backend). */
  reasons: z.array(z.string()).default([]),
});

export const CriterionSchema = z.object({
  palier: PalierSchema,
  criterion: z.string(),
  state: z.enum(['rempli', 'non_rempli', 'non_evalue']),
  note: z.string(),
  /** Le backend envoie des entiers ; le dashboard les normalise en « EV-n ». */
  event_ids: z.array(z.union([z.string(), z.number()])),
});

export const PalierDefSchema = z.object({ value: PalierSchema, label: z.string(), definition: z.string() });

/** `GET /api/v1/gauge/detail` */
export const GaugeDetailSchema = z.object({
  gauge: GaugeStateSchema,
  criteria: z.array(CriterionSchema),
  coverage: z.object({
    profile_satisfied: z.boolean(),
    profile_label: z.string(),
    families: z.array(CoverageFamilySchema),
    pending_documents: z.number(),
    pending_major_review: z.number(),
    baseline: z.object({ sufficient: z.boolean(), detail: z.string() }),
    reasons: z.array(z.string()).default([]),
  }),
  events: z.array(
    z.object({
      id: z.number(),
      type: z.string(),
      zone: z.string().nullable(),
      title: z.string(),
      role: z.string(),
      family: z.string().nullable().optional(),
      direct: z.boolean().optional(),
      origins: z.number().optional(),
      why: z.string().optional(),
      flags: z.array(z.string()).optional(),
    }),
  ),
  raw_palier: z.number().nullable(),
  pending_downgrade: z.object({ target: z.number(), count: z.number(), needed: z.number() }).nullable().optional(),
  floor_annotated: z.number().nullable().optional(),
  paliers: z.array(PalierDefSchema),
});

/* ---------- conclusion, hypothèses (moteur d'hypothèses : pas encore côté backend) ---------- */

export const HypothesisIdSchema = z.enum(['H0', 'H1', 'H2', 'H3', 'H4']);
export const HypothesisSchema = z.object({
  id: HypothesisIdSchema,
  label: z.string(),
  verdict: z.enum(['soutenue', 'compatible', 'contredite', 'donnees_insuffisantes']),
  supports: z.array(z.string()),
  contradicts: z.array(z.string()),
  missing: z.array(z.string()),
  evidence_ids: z.array(z.string()),
});

export const ConclusionSchema = z.object({
  template_version: z.string(),
  orientation: z.object({ text: z.string(), hypothesis_id: HypothesisIdSchema.nullable() }).nullable(),
  evidence_ids: z.array(z.string()),
  trend: z.object({ period: z.string(), direction: TrendSchema }),
  alternative: z.object({ text: z.string(), missing_discriminant: z.string() }).nullable(),
  ambiguous: z.boolean(),
  suspended_reason: z.string().optional(),
});

/* ---------- événements ---------- */

export const SourceKindSchema = z.enum(['mesure', 'operateur', 'autorite', 'media']);
export const LayerIdSchema = z.enum(['restrictions', 'aviation', 'reseaux', 'incidents', 'mesures', 'satellite']);
export const ReadingStatusSchema = z.enum(['retenu', 'contexte', 'a_verifier']);
export const ExclusionReasonSchema = z.enum(['doublon', 'hors_perimetre', 'perime', 'preuve_insuffisante']);

export const EventSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: SourceKindSchema,
  official: z.boolean(),
  published_at: IsoOrNull,
  retrieved_at: Iso,
  url: z.string(),
  excerpt: z.string(),
  origin_id: z.string(),
  is_original: z.boolean(),
  date_flags: z.array(z.string()).optional(),
});

export const EventLocationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('point'),
    lon: z.number(),
    lat: z.number(),
    precision: z.enum(['pays', 'region', 'indicatif']),
    /** Le backend envoie le code de zone ; le dashboard affiche le nom (lib/zones.ts). */
    label: z.string(),
    /** Code ISO 3166-1 alpha-2 de la zone (config/zones.yaml). */
    iso: z.string().optional(),
    zone_code: z.string().optional(),
  }),
  z.object({ kind: z.literal('none'), reason: z.string() }),
]);

export const CriterionEffectSchema = z.object({
  palier: PalierSchema,
  criterion: z.string(),
  state: z.enum(['rempli', 'non_rempli', 'non_evalue']),
  note: z.string(),
});

export const ProposedLinkSchema = z.object({
  event_id: z.string(),
  link_type: z.enum(['possible_common_cause', 'possible_duplicate']),
  reason: z.string(),
});

/** Affirmation rattachée à l'événement : la confirmation officielle est PAR affirmation (plan §4). */
export const ClaimSchema = z.object({
  id: z.number(),
  category: z.string(),
  claim_type: z.enum(['observation', 'declaration', 'inference']),
  role: z.enum(['primary', 'corroboration', 'contradiction', 'attribution']),
  negated: z.boolean(),
  confirmation: z.enum(['none', 'official']),
  declarant: z.string().nullable(),
  certainty: z.enum(['structured', 'provisional']),
  needs_review: z.boolean(),
  statement: z.string(),
});

/** Revue humaine déjà enregistrée sur l'événement. */
export const AnnotationSchema = z.object({
  id: z.number(),
  qualification: z.string(),
  details: z.record(z.string(), z.unknown()),
  note: z.string(),
  actor: z.string(),
  created_at: Iso,
});

export const VeilleEventSchema = z.object({
  id: z.string().regex(/^EV-\d+$/),
  title: z.string(),
  layer: LayerIdSchema,
  event_type: z.string().optional(),
  zone_code: z.string().nullable().optional(),
  /**
   * Sous-zone d'outre-mer (ex. « NC »). ABSENT aujourd'hui du backend, qui rattache l'outre-mer à FR (demande à A) :
   * quand il est présent, la carte place le marqueur sur le territoire plutôt que sur la métropole.
   */
  place_code: z.string().nullable().optional(),
  /** true = donnée de démonstration (mode maquette) ; false avec l'API réelle. */
  fictional: z.boolean(),
  reading_status: ReadingStatusSchema,
  exclusion: z.object({ reason: ExclusionReasonSchema, detail: z.string() }).nullable(),
  evidence_status: z.enum(['directe', 'deux_origines', 'origine_unique', 'non_corroboree']),
  occurred_at: IsoOrNull,
  /** Vocabulaire du backend. */
  occurred_precision: z.enum(['instant', 'day', 'month', 'year', 'unknown']),
  published_at: IsoOrNull,
  first_seen_at: Iso,
  retrieved_at: Iso,
  expires_at: IsoOrNull,
  location: EventLocationSchema,
  observed_fact: z.string(),
  hypotheses: z.array(z.string()),
  contradictions: z.array(z.string()),
  rule: z.object({ id: z.string(), version: z.string().nullable() }),
  effect: CriterionEffectSchema,
  sources: z.array(EventSourceSchema),
  independent_origins: z.number(),
  /** Le backend renvoie []; le dashboard le complète à partir des dossiers (event_ids). */
  dossier_ids: z.array(z.string()),
  proposed_links: z.array(ProposedLinkSchema),
  claims: z.array(ClaimSchema).optional(),
  annotations: z.array(AnnotationSchema).optional(),
});

export const CountersSchema = z.object({
  documents_collected: z.number(),
  unique_events: z.number(),
  excluded: z.number(),
  retained: z.number(),
  excluded_by_reason: z.object({ doublon: z.number(), hors_perimetre: z.number(), perime: z.number(), preuve_insuffisante: z.number() }),
});

/* ---------- dossiers, historique ---------- */

export const DossierScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  zone: z.string(),
  horizon: z.string(),
  state: z.enum(['actif', 'indetermine', 'veille']),
  summary: z.string(),
  rules_version: z.string(),
  rule_interpretation: z.object({
    conclusion: z.string(),
    supports: z.array(z.string()),
    contradicts: z.array(z.string()),
    missing: z.array(z.string()),
    hypotheses: z.array(HypothesisSchema),
  }),
  /** Le backend envoie des entiers ; normalisés en « EV-n ». */
  event_ids: z.array(z.union([z.string(), z.number()])),
  updated_at: Iso,
});

export const HistoryPointSchema = z.object({
  at: Iso,
  palier: PalierSchema.nullable(),
  policy_version: z.string(),
  status: z.enum(['calculable', 'non_calculable']).optional(),
});

export const MethodChangeSchema = z.object({
  at: Iso,
  from_version: z.string(),
  to_version: z.string(),
  note: z.string(),
  handling: z.enum(['tendance_suspendue', 'historique_recalcule']),
});

/** `GET /api/v1/gauge/history` */
export const GaugeHistorySchema = z.object({ points: z.array(HistoryPointSchema), method_changes: z.array(MethodChangeSchema) });

/* ---------- sources, journal, revue ---------- */

export const SourceVerdictSchema = z.enum(['OK', 'BLOCKED', 'FAIL', 'SKIPPED']);
export const SourceHealthStateSchema = z.enum(['ok', 'retard', 'indisponible', 'desactivee']);

export const SourceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  organism: z.string(),
  kind: SourceKindSchema,
  family: z.string(),
  zone: z.string(),
  access: z.string(),
  expected_delay: z.string(),
  frequency: z.string(),
  state: SourceHealthStateSchema,
  state_detail: z.string(),
  last_attempt: IsoOrNull,
  last_success: IsoOrNull,
  last_novelty: IsoOrNull,
  licence: z.string(),
  verdict: SourceVerdictSchema,
  verdict_reason: z.string(),
  verification_status: z.string().optional(),
  enabled: z.boolean().optional(),
  consecutive_failures: z.number().optional(),
});

export const JournalEntrySchema = z.object({
  id: z.string(),
  at: Iso,
  kind: z.enum(['palier', 'methode', 'source', 'evenement', 'notification', 'revue']),
  text: z.string(),
  simulated: z.boolean(),
});

/** `GET /api/v1/reviews` : file de revue humaine. */
export const ReviewItemSchema = z.object({
  id: z.number(),
  kind: z.string(),
  document_id: z.number().nullable(),
  claim_id: z.number().nullable(),
  event_id: z.string().nullable(),
  reason: z.string(),
  status: z.string(),
  created_at: Iso,
});

/* ---------- alertes, IA, notifications ---------- */

export const CivilAlertSchema = z.object({ title: z.string(), detail: z.string(), issuer: z.string(), instruction_url: z.string(), since: Iso });
export const NuclearKindSchema = z.enum(['discours', 'exercice', 'alerte_radiologique', 'emploi_confirme']);
export const NuclearBadgeSchema = z.object({ kind: NuclearKindSchema, scope: z.string(), source: z.string(), status: z.string(), instructions: z.string() });

export const AiModeSchema = z.enum(['desactivee', 'a_la_demande', 'automatique']);
export const AiStateSchema = z.object({
  mode: AiModeSchema,
  budget_exhausted: z.boolean(),
  /** false = routes /ai/* pas encore implémentées côté serveur. */
  available: z.boolean(),
  estimate: z.object({ max_cost_usd: z.number(), scope_current: z.string(), scope_extended: z.string() }),
  monthly_cap_usd: z.number(),
  monthly_used_usd: z.number(),
  previous_runs: z.array(z.object({ at: Iso, model: z.string(), agreement_with_rules: z.enum(['accord', 'desaccord_partiel', 'desaccord']), summary: z.string() })),
});

export const NotificationLevelSchema = z.enum(['officiel', 'officiel_a3', 'officiel_a2_a3']);
export const NotificationSettingsSchema = z.object({
  enabled: z.boolean(),
  silent_until_pilot_end: z.boolean(),
  level: NotificationLevelSchema,
  channel: z.literal('telegram'),
  channel_state: z.literal('non_active'),
  /** false = pas de route serveur (lot 7) : affiché en lecture seule. */
  editable: z.boolean(),
});

/* ---------- seuils versionnés ---------- */

export const ThresholdItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  unit: z.string(),
  plan_value: z.number(),
  value: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  affects: z.string(),
});

export const ThresholdChangeSchema = z.object({
  id: z.string(),
  at: Iso,
  kind: z.enum(['modification', 'retour_plan']),
  key: z.string(),
  label: z.string(),
  from: z.number(),
  to: z.number(),
  reason: z.string(),
  actor: z.string(),
  policy_version: z.string(),
});

/** `GET /api/v1/thresholds` */
export const ThresholdsStateSchema = z.object({
  policy_version: z.string(),
  plan_version: z.string(),
  /**
   * Indicateur de configuration serveur « seuils gelés pendant le pilote ». ABSENT aujourd'hui du backend (demande à A) :
   * le dashboard traite l'absence comme « gelé » (valeur sûre) ; seul `false` explicite débloque l'édition.
   */
  pilot_frozen: z.boolean().optional(),
  items: z.array(ThresholdItemSchema),
  history: z.array(ThresholdChangeSchema),
});

/* ---------- instantané composé par le dashboard ---------- */

export const SnapshotSchema = z.object({
  scenario_id: z.string(),
  as_of: Iso,
  last_collect: Iso,
  territories: z.array(TerritorySchema),
  gauge: GaugeStateSchema,
  coverage: CoverageSchema,
  /** Critères évalués (`gauge/detail`) : « pourquoi ce palier ». */
  criteria: z.array(CriterionSchema),
  /** Définitions des 8 paliers fournies par le backend (sinon table locale). */
  paliers: z.array(PalierDefSchema).optional(),
  /** null tant que le moteur d'hypothèses n'existe pas côté serveur. */
  conclusion: ConclusionSchema.nullable(),
  hypotheses: z.array(HypothesisSchema),
  events: z.array(VeilleEventSchema),
  counters: CountersSchema,
  dossiers: z.array(DossierScenarioSchema),
  history: z.array(HistoryPointSchema),
  method_changes: z.array(MethodChangeSchema),
  sources: z.array(SourceRecordSchema),
  reviews: z.array(ReviewItemSchema),
  journal: z.array(JournalEntrySchema),
  /** true = le serveur n'a pas de route /journal : seuls les changements de seuils sont listés. */
  journal_partial: z.boolean(),
  civil_alert: CivilAlertSchema.nullable(),
  nuclear: NuclearBadgeSchema.nullable(),
  ai: AiStateSchema,
  thresholds: ThresholdsStateSchema,
  notifications: NotificationSettingsSchema,
  /** Mode maquette : bandeau permanent « DONNÉES FICTIVES — MAQUETTE ». */
  demo: z.boolean(),
});

/* ---------- flux SSE ---------- */

export const StreamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), data: SnapshotSchema }),
  z.object({ type: z.literal('event.upserted'), data: VeilleEventSchema }),
  z.object({ type: z.literal('source.health'), data: SourceRecordSchema }),
  z.object({ type: z.literal('gauge.updated'), data: GaugeStateSchema }),
]);

/** Corps d'erreur de l'API : {"error":{"code","message"}} partout. */
export const ApiErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
