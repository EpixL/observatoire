/**
 * ÉCHANTILLONS DE RÉPONSES « FORME RÉELLE » du backend (branche `backend`, commit 133aace).
 * Écrits à la main d'après le code — `backend/app/api/main.py`, `serializers.py`, `gauge/snapshots.py`, `gauge/policy.py`,
 * `config/index-scale.yaml` — et non capturés sur un serveur en marche (aucun backend n'a tourné ici). Ils servent à :
 *   1. vérifier que les schémas du dashboard acceptent bien ce que le backend envoie (src/schema.test.ts) ;
 *   2. tester la composition de l'instantané en mode live (src/api/client.test.ts, e2e/live.spec.ts).
 * Particularités du backend reproduites exprès : dates en « +00:00 », ids d'événements en « EV-<n> » mais ids ENTIERS dans
 * dossiers et critères, `label` de localisation = code de zone, `dossier_ids` et `hypotheses` vides, `place_code` absent,
 * outre-mer rattaché à FR, `pilot_frozen` absent.
 */
import { PLAN_THRESHOLDS, PALIER_DEFS, TERRITORIES } from './scenarios';

const NOW = '2026-10-30T10:00:00+00:00';
const ago = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString().replace('Z', '+00:00').replace('.000', '');

export const SAMPLE_TERRITORIES = TERRITORIES.map((t) => ({ id: t.id, label: t.label, zones: [...t.zones].sort(), default: t.default }));

/** `GET /api/v1/gauge?territory=flanc-est` */
export const SAMPLE_GAUGE = {
  territory: { id: 'flanc-est', label: 'Flanc est de l’Europe' },
  status: 'calculable',
  palier: 25,
  last_known: { palier: 25, at: NOW },
  partial_coverage: false,
  as_of: NOW,
  trend_24h: { direction: 'non_comparable', from: null, to: 25, reason: 'historique insuffisant sur cette période' },
  trend_7d: { direction: 'non_comparable', from: null, to: 25, reason: 'historique insuffisant sur cette période' },
  policy: { version: 'seuils-v1', plan_version: 'seuils-v1', label: 'Seuils seuils-v1 (valeurs du plan)' },
  rule_id: 'R-P25',
  rules_version: 'gauge-1.0',
};

const coverage = {
  profile_satisfied: false,
  profile_label: 'Profil pilote : 3 familles obligatoires à jour + référence quantitative suffisante',
  families: [
    { id: 'autorites_mesures', label: 'Autorités et mesures', state: 'degrade', detail: 'easa-czib : à jour · france-diplomatie-cv : désactivée' },
    { id: 'faits_regionaux', label: 'Faits régionaux corroborables', state: 'ok', detail: 'france24-fr : à jour' },
    { id: 'mesure_technique', label: 'Mesure technique', state: 'ok', detail: 'ioda-fr : à jour' },
  ],
  pending_documents: 1,
  pending_major_review: 0,
  baseline: { sufficient: false, detail: '0.4 semaine(s) de collecte réelle de ioda-fr sur 8 requise(s) : référence insuffisante' },
  reasons: ['familles à jour : 2 sur 3 requises', '0.4 semaine(s) de collecte réelle de ioda-fr sur 8 requise(s) : référence insuffisante'],
};

/** `GET /api/v1/gauge/detail?territory=flanc-est` (critères : ids d'événements ENTIERS) */
export const SAMPLE_DETAIL = {
  gauge: SAMPLE_GAUGE,
  criteria: [
    { palier: 0, criterion: 'Aucun signal qualifiant observé', state: 'non_rempli', note: 'Au moins un critère est actif.', event_ids: [] },
    { palier: 10, criterion: 'Signal isolé', state: 'rempli', note: '1 événement(s) pertinent(s).', event_ids: [3] },
    { palier: 25, criterion: 'Tension documentée', state: 'rempli', note: 'Mesure technique directe (IODA).', event_ids: [3] },
    { palier: 40, criterion: 'Convergence préoccupante', state: 'non_rempli', note: '1 événement matériel sur 2 requis.', event_ids: [] },
    { palier: 55, criterion: 'Préparation à une crise majeure', state: 'non_rempli', note: 'Aucun changement de posture relevé.', event_ids: [] },
    { palier: 70, criterion: 'Action hostile grave documentée', state: 'non_evalue', note: 'Aucune revue humaine ne qualifie ce palier.', event_ids: [] },
    { palier: 85, criterion: 'Attaque armée directe établie', state: 'non_evalue', note: 'Aucune revue humaine ne qualifie ce palier.', event_ids: [] },
    { palier: 100, criterion: 'Conflit armé direct en cours', state: 'non_evalue', note: 'Aucune revue humaine ne qualifie ce palier.', event_ids: [] },
  ],
  coverage,
  events: [{ id: 3, type: 'internet_outage', zone: 'LT', title: 'Baisse du signal Internet en Lituanie', role: 'material', family: 'technical', direct: true, origins: 1, why: 'mesure technique IODA', flags: [] }],
  raw_palier: 25,
  pending_downgrade: null,
  floor_annotated: 0,
  paliers: PALIER_DEFS.map((d) => ({ value: d.value, label: d.label, definition: d.definition })),
};

/** `GET /api/v1/gauge/history?territory=flanc-est&days=30` */
export const SAMPLE_HISTORY = {
  points: [
    { at: ago(48), palier: null, policy_version: 'seuils-v1', status: 'non_calculable' },
    { at: ago(24), palier: null, policy_version: 'seuils-v1', status: 'non_calculable' },
    { at: NOW, palier: 25, policy_version: 'seuils-v1', status: 'calculable' },
  ],
  method_changes: [],
};

/** `GET /api/v1/dossiers?territory=flanc-est` (event_ids ENTIERS ; hypotheses toujours []) */
export const SAMPLE_DOSSIERS = ['D-CIV', 'D-REG', 'D-EXT'].map((id, i) => ({
  id,
  title: ['Perturbation majeure de services civils', 'Dégradation régionale de sécurité', 'Extension géographique d\'un conflit'][i],
  zone: 'Flanc est de l’Europe',
  horizon: ['présent à 72 heures', '7 jours', '30 jours'][i],
  state: i === 0 ? 'actif' : 'veille',
  summary: i === 0 ? '1 événement(s) dans la fenêtre de présent à 72 heures, 1 origine(s) indépendante(s), zones : LT.' : `Aucun événement retenu sur ${['', '7 jours', '30 jours'][i]}.`,
  rules_version: 'dossiers-1.0',
  event_ids: i === 0 ? [3] : [],
  updated_at: NOW,
  rule_interpretation: {
    conclusion: i === 0 ? '1 événement(s) dans la fenêtre de présent à 72 heures.' : 'Aucun événement retenu.',
    supports: i === 0 ? ['Baisse du signal Internet en Lituanie — mesure technique IODA'] : [],
    contradicts: [],
    missing: ['Profil de couverture non satisfait : aucune conclusion rassurante possible', 'Moteur d\'hypothèses non implémenté (lot 3, reste à faire)'],
    hypotheses: [],
  },
}));

/** `GET /api/v1/events?territory=flanc-est&include_excluded=true` */
export const SAMPLE_EVENTS = [
  {
    id: 'EV-3',
    title: 'Baisse du signal Internet en Lituanie',
    layer: 'reseaux',
    event_type: 'internet_outage',
    fictional: false,
    reading_status: 'retenu',
    exclusion: null,
    evidence_status: 'deux_origines',
    occurred_at: ago(6),
    occurred_precision: 'instant',
    published_at: ago(5),
    first_seen_at: ago(5),
    retrieved_at: ago(4.8),
    expires_at: null,
    location: { kind: 'point', lon: 23.9, lat: 55.3, precision: 'pays', label: 'LT', iso: 'LT' },
    zone_code: 'LT',
    observed_fact: 'Baisse de 38 % du signal de routage sur 3 systèmes autonomes.',
    hypotheses: [],
    contradictions: [],
    rule: { id: 'R-P25', version: 'gauge-1.0' },
    effect: { palier: 25, criterion: 'Tension documentée', state: 'rempli', note: 'Mesure technique directe (IODA).' },
    sources: [
      {
        id: 'ioda-lt',
        name: 'IODA — Lituanie',
        kind: 'mesure',
        official: false,
        published_at: ago(5),
        retrieved_at: ago(4.8),
        url: 'https://ioda.example/lt',
        excerpt: 'Chute du signal de routage.',
        origin_id: 'O-12',
        is_original: true,
        date_flags: [],
      },
    ],
    independent_origins: 2,
    dossier_ids: [],
    proposed_links: [{ event_id: 'EV-7', link_type: 'possible_common_cause', reason: 'Même zone, même fenêtre de 24 h : cause commune possible (météo).' }],
    claims: [
      { id: 21, category: 'internet_outage', claim_type: 'observation', role: 'primary', negated: false, confirmation: 'none', declarant: 'IODA', certainty: 'structured', needs_review: false, statement: 'Baisse du signal Internet en Lituanie.' },
    ],
    annotations: [],
  },
  {
    id: 'EV-4',
    title: 'Avis de navigation prolongé, republication',
    layer: 'restrictions',
    event_type: 'airspace_advisory',
    fictional: false,
    reading_status: 'contexte',
    exclusion: { reason: 'perime', detail: 'republication ou événement ancien : écarté de l\'analyse' },
    evidence_status: 'origine_unique',
    occurred_at: null,
    occurred_precision: 'unknown',
    published_at: null,
    first_seen_at: ago(30),
    retrieved_at: ago(30),
    expires_at: null,
    location: { kind: 'none', reason: 'lieu non identifié ou hors gazetier : non localisé' },
    zone_code: null,
    observed_fact: 'Avis republié.',
    hypotheses: [],
    contradictions: [],
    rule: { id: 'R-P25', version: 'gauge-1.0' },
    effect: { palier: 10, criterion: 'Non évalué par les règles', state: 'non_evalue', note: '' },
    sources: [],
    independent_origins: 1,
    dossier_ids: [],
    proposed_links: [],
    claims: [],
    annotations: [],
  },
];

/** `GET /api/v1/sources/status` : tous les verdicts de la table de correspondance. */
export const SAMPLE_SOURCES = [
  ['ioda-fr', 'IODA — France', 'mesure', 'ok', 'OK', 'dernière collecte réussie'],
  ['easa-czib', 'EASA — CZIB', 'autorite', 'retard', 'OK', '1 échec récent : délai dépassé'],
  ['france24-fr', 'France 24 — Une', 'media', 'indisponible', 'FAIL', 'échecs répétés'],
  ['cert-fr-alertes', 'CERT-FR — alertes', 'autorite', 'indisponible', 'BLOCKED', 'page protégée par un contrôle anti-robot'],
  ['sgdsn-vigipirate', 'SGDSN — Vigipirate', 'autorite', 'desactivee', 'SKIPPED', 'désactivée : bloquée par un service anti-robot'],
  ['france-diplomatie-cv', 'France Diplomatie — conseils', 'autorite', 'retard', 'SKIPPED', 'jamais interrogée'],
].map(([id, name, kind, state, verdict, reason]) => ({
  id,
  name,
  organism: String(name).split(' — ')[0],
  kind,
  family: String(id).split('-')[0],
  zone: 'FR',
  access: 'feed',
  expected_delay: 'non mesuré',
  frequency: 'toutes les 10 min',
  state,
  state_detail: reason,
  last_attempt: state === 'desactivee' || reason === 'jamais interrogée' ? null : ago(0.1),
  last_success: verdict === 'OK' ? ago(0.1) : null,
  last_novelty: verdict === 'OK' ? ago(3) : null,
  licence: 'à vérifier',
  verdict,
  verdict_reason: reason,
  verification_status: 'verified',
  enabled: state !== 'desactivee',
  consecutive_failures: verdict === 'FAIL' ? 4 : 0,
}));

/** `GET /api/v1/thresholds` : 11 seuils du backend, `pilot_frozen` ABSENT. */
export const SAMPLE_THRESHOLDS = {
  policy_version: 'seuils-v2',
  plan_version: 'seuils-v1',
  items: PLAN_THRESHOLDS.map((t) => ({ ...t, value: t.key === 'events_for_40' ? 3 : t.value })),
  history: [
    { id: 'T-1', at: ago(20), kind: 'modification', key: 'events_for_40', label: 'Événements matériels distincts pour le palier 40', from: 2, to: 3, reason: 'essai de sensibilité', actor: 'David', policy_version: 'seuils-v2' },
  ],
};

/** `GET /api/v1/reviews?status=open` */
export const SAMPLE_REVIEWS = [
  { id: 7, kind: 'unqualified_document', document_id: 55, claim_id: null, event_id: null, reason: 'texte non interprété par le moteur', status: 'open', created_at: ago(2) },
  { id: 8, kind: 'claim_qualification', document_id: 56, claim_id: 21, event_id: 'EV-3', reason: 'qualification hostile issue de prose', status: 'open', created_at: ago(1) },
];

/** Corps d'erreur du backend. */
export const SAMPLE_NOT_EVALUATED = { error: { code: 'not_evaluated', message: 'la jauge n\'a pas encore été évaluée pour ce territoire (attendre le prochain tour du worker)' } };
export const sampleError = (code: string, message: string) => ({ error: { code, message } });

/** Route → réponse, pour simuler le backend (tests unitaires et Playwright). */
export function backendRoutes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/api/v1/territories': SAMPLE_TERRITORIES,
    '/api/v1/gauge': SAMPLE_GAUGE,
    '/api/v1/gauge/detail': SAMPLE_DETAIL,
    '/api/v1/gauge/history': SAMPLE_HISTORY,
    '/api/v1/dossiers': SAMPLE_DOSSIERS,
    '/api/v1/events': SAMPLE_EVENTS,
    '/api/v1/sources/status': SAMPLE_SOURCES,
    '/api/v1/thresholds': SAMPLE_THRESHOLDS,
    '/api/v1/reviews': SAMPLE_REVIEWS,
    ...overrides,
  };
}
