import type {
  AiState,
  Conclusion,
  Counters,
  Coverage,
  DossierScenario,
  ExclusionReason,
  GaugeState,
  HistoryPoint,
  Hypothesis,
  JournalEntry,
  MethodChange,
  Palier,
  NotificationSettings,
  Criterion,
  ReviewItem,
  Territory,
  Snapshot,
  SourceRecord,
  SourceVerdict,
  ThresholdChange,
  ThresholdItem,
  ThresholdsState,
  VeilleEvent,
} from '../types';
import { BASE_EVENTS, FLOOD_EVENT, GRAVE_EVENT, NOW } from './events';

const t = (hoursAgo: number): string => new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString().replace('.000Z', 'Z');

export interface ScenarioMeta {
  id: string;
  label: string;
}

export const SCENARIOS: ScenarioMeta[] = [
  { id: 'nominal', label: 'Nominal — palier 40' },
  { id: 'indisponible', label: 'Données indisponibles' },
  { id: 'ambigu', label: 'Situation ambiguë' },
  { id: 'civile', label: 'Alerte civile majeure' },
  { id: 'nucleaire', label: 'Badge nucléaire / radiologique' },
  { id: 'methode', label: 'Changement de méthode' },
  { id: 'partielle', label: 'Fait grave, couverture partielle' },
  { id: 'seuils', label: 'Seuils de la jauge modifiés' },
];

/* ---------- Hypothèses ---------- */

const H = (h: Hypothesis): Hypothesis => h;

const hypothesesNominal: Hypothesis[] = [
  H({ id: 'H3', label: 'Préparation défensive / précaution', verdict: 'soutenue', supports: ['Restriction aérienne nouvelle (EV-1)', 'Conseil aux voyageurs renforcé (EV-3)'], contradicts: [], missing: ['Changement de posture militaire publiquement documenté'], evidence_ids: ['EV-1', 'EV-3'] }),
  H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé du 31 octobre au 7 novembre (EV-4)'], contradicts: ['Le calendrier de l’exercice ne couvre pas la zone de la restriction'], missing: ['Calendrier précis de l’exercice et zone exacte'], evidence_ids: ['EV-4'] }),
  H({ id: 'H1', label: 'Incident technique / météo', verdict: 'compatible', supports: ['Cause commune météo non exclue pour la coupure Internet (EV-2)'], contradicts: [], missing: ['Communiqué de l’opérateur sur la cause'], evidence_ids: ['EV-2'] }),
  H({ id: 'H2', label: 'Intimidation / dissuasion', verdict: 'donnees_insuffisantes', supports: [], contradicts: [], missing: ['Déclarations officielles ou signalement de posture'], evidence_ids: [] }),
  H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'donnees_insuffisantes', supports: [], contradicts: ['Aucun acte hostile établi (EV-5 non corroboré)'], missing: ['Acte hostile documenté par une autorité'], evidence_ids: ['EV-5'] }),
];

const hypothesesAmbigu: Hypothesis[] = [
  H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé (EV-4)'], contradicts: [], missing: ['Zone exacte de l’exercice'], evidence_ids: ['EV-4'] }),
  H({ id: 'H1', label: 'Incident technique / météo', verdict: 'compatible', supports: ['Coupure Internet avec météo défavorable (EV-2)'], contradicts: [], missing: ['Cause de la coupure'], evidence_ids: ['EV-2'] }),
  H({ id: 'H2', label: 'Intimidation / dissuasion', verdict: 'compatible', supports: ['Restriction aérienne sans motif (EV-1)'], contradicts: [], missing: ['Posture officielle publiée'], evidence_ids: ['EV-1'] }),
  H({ id: 'H3', label: 'Préparation défensive / précaution', verdict: 'compatible', supports: ['Conseil renforcé (EV-3)'], contradicts: [], missing: ['Mesure de précaution effective liée à la restriction'], evidence_ids: ['EV-3'] }),
  H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'compatible', supports: [], contradicts: ['Aucun acte hostile établi'], missing: ['Élément discriminant : changement de posture'], evidence_ids: [] }),
];

/* ---------- Dossiers ---------- */

function dossiers(hyp: Hypothesis[], civilTitle?: string): DossierScenario[] {
  return [
    {
      id: 'D-CIV',
      title: civilTitle ?? 'Perturbation majeure de services civils',
      zone: 'Flanc est de l’Europe',
      horizon: 'Présent à 72 heures',
      state: 'actif',
      summary: 'Coupures mesurées, opérateurs affectés, durée et étendue.',
      rules_version: 'dossier-civil 1.2',
      rule_interpretation: {
        conclusion: 'Une perturbation réseau partielle est confirmée par deux origines indépendantes ; sa cause reste inconnue. Plusieurs interprétations restent possibles.',
        supports: ['Mesure technique et opérateur concordants (EV-2)'],
        contradicts: ['Panne technique reconnue et rétablie pour un autre territoire (EV-7) : indépendante, sans effet sur ce dossier'],
        missing: ['Cause déclarée par l’opérateur', 'Étendue géographique précise'],
        hypotheses: hyp.filter((x) => ['H1', 'H3'].includes(x.id)),
      },
      event_ids: [2, 7, 101],
      updated_at: t(3),
    },
    {
      id: 'D-REG',
      title: 'Dégradation régionale de sécurité',
      zone: 'Flanc est de l’Europe',
      horizon: '7 jours',
      state: 'actif',
      summary: 'Incidents corroborés, restrictions civiles, changements diplomatiques et de posture documentés.',
      rules_version: 'dossier-regional 1.4',
      rule_interpretation: {
        conclusion: 'Durcissement des précautions documenté : restriction aérienne et conseil aux voyageurs renforcé. Cela soutient un changement de comportement ; cela ne démontre pas une préparation offensive.',
        supports: ['Restriction aérienne effective (EV-1)', 'Conseil aux voyageurs renforcé (EV-3)'],
        contradicts: ['Exercice annoncé (EV-4) pouvant expliquer une partie des mesures'],
        missing: ['Changement de posture publiquement documenté', 'Corroboration de l’affirmation de sabotage (EV-5)'],
        hypotheses: hyp,
      },
      event_ids: [1, 2, 3, 4, 5, 6, 13, 102],
      updated_at: t(2),
    },
    {
      id: 'D-EXT',
      title: 'Extension géographique d’un conflit',
      zone: 'Monde',
      horizon: '30 jours',
      state: 'indetermine',
      summary: 'Nouveaux territoires concernés, actes confirmés, mesures durables.',
      rules_version: 'dossier-extension 1.0',
      rule_interpretation: {
        conclusion: 'Indéterminé : aucune donnée structurée ne permet d’évaluer une extension sur 30 jours.',
        supports: [],
        contradicts: [],
        missing: ['Référence quantitative sur 8 à 12 semaines', 'Actes confirmés dans de nouveaux territoires'],
        hypotheses: [],
      },
      event_ids: [],
      updated_at: t(30),
    },
  ];
}

/* ---------- Sources ---------- */

type SrcInit = Omit<SourceRecord, 'state' | 'state_detail' | 'last_attempt' | 'last_success' | 'last_novelty' | 'verdict' | 'verdict_reason'>;
const SOURCE_REGISTRY: SrcInit[] = [
  { id: 'S-MAE', name: 'Conseils aux voyageurs et dernières minutes', organism: 'France Diplomatie', kind: 'autorite', family: 'Autorités / mesures', zone: 'Monde', access: 'RSS + pages', expected_delay: '2–5 min', frequency: '5 min', licence: 'À vérifier à l’implémentation' },
  { id: 'S-EASA', name: 'Conflict Zone Information Bulletins', organism: 'EASA', kind: 'autorite', family: 'Autorités / mesures', zone: 'Europe', access: 'RSS / JSON', expected_delay: '2–5 min', frequency: '5 min', licence: 'À vérifier à l’implémentation' },
  { id: 'S-IODA', name: 'Interruptions Internet', organism: 'IODA', kind: 'mesure', family: 'Mesure technique', zone: 'Monde', access: 'API', expected_delay: '5–10 min', frequency: '10 min', licence: 'À vérifier à l’implémentation' },
  { id: 'S-GOUV', name: 'Gouvernements et protection civile (liste blanche)', organism: 'Autorités nationales', kind: 'autorite', family: 'Autorités / mesures', zone: 'Zones retenues', access: 'RSS 2–5 min / pages 10–15 min', expected_delay: '2–15 min', frequency: '5 min', licence: 'Variable selon l’éditeur' },
  { id: 'S-OTAN', name: 'Décisions et communiqués', organism: 'OTAN, UE / SEAE', kind: 'autorite', family: 'Autorités / mesures', zone: 'Europe', access: 'RSS', expected_delay: '5–10 min', frequency: '10 min', licence: 'À vérifier à l’implémentation' },
  { id: 'S-MET', name: 'Météo officielle et calendriers d’exercices', organism: 'Météo-France, états-majors', kind: 'mesure', family: 'Contexte', zone: 'France, Europe', access: 'API + pages', expected_delay: '30–60 min', frequency: '30 min', licence: 'Licence ouverte (à confirmer)' },
  { id: 'S-MEDIA', name: 'Médias à sources identifiables', organism: 'Sélection éditée', kind: 'media', family: 'Faits régionaux corroborables', zone: 'Europe', access: 'Flux autorisés', expected_delay: '5–15 min', frequency: '15 min', licence: 'Extraits limités par licence' },
  { id: 'S-CERT', name: 'Alertes et actualité menaces', organism: 'CERT-FR', kind: 'autorite', family: 'Contexte', zone: 'France', access: 'RSS', expected_delay: '10–15 min', frequency: '15 min', licence: 'À vérifier à l’implémentation' },
  { id: 'S-AVIA', name: 'Aviation civile agrégée (phase V2)', organism: 'OpenSky et avis officiels', kind: 'mesure', family: 'Mesure technique', zone: 'Europe', access: 'API avec quota', expected_delay: '5–15 min', frequency: '15 min', licence: 'Quota et conditions à vérifier' },
];

function sources(scn: string): SourceRecord[] {
  return SOURCE_REGISTRY.map((s, i) => {
    let state: SourceRecord['state'] = 'ok';
    let verdict: SourceVerdict = 'OK';
    let reason = 'Dernière collecte réussie, dans les délais attendus.';
    let attempt: string | null = t(0.1 + i * 0.05);
    let success: string | null = attempt;
    const novelty: string | null = t(2 + i * 3);
    if (s.id === 'S-OTAN') {
      state = 'indisponible';
      verdict = 'BLOCKED';
      reason = 'Page protégée par un contrôle anti-robot : aucun contournement (règle du projet). Source de secours active.';
      success = t(40);
    }
    if (s.id === 'S-CERT') {
      state = 'desactivee';
      verdict = 'SKIPPED';
      reason = 'Source facultative V1, désactivée dans la configuration (aucun endpoint vérifié).';
      attempt = null;
      success = null;
    }
    if (s.id === 'S-AVIA') {
      state = 'retard';
      reason = 'Réponse reçue mais quota partiellement consommé : cadence réduite, couverture des récepteurs 62 %.';
      success = t(1.2);
    }
    if (scn === 'indisponible' && s.id === 'S-IODA') {
      state = 'indisponible';
      verdict = 'FAIL';
      reason = 'Échec de connexion depuis 18 h (délai dépassé, 12 échecs consécutifs). Dernier succès conservé ; aucune ancienne observation n’est présentée comme un flux en direct.';
      success = t(18);
    }
    if (scn === 'indisponible' && s.id === 'S-AVIA') {
      state = 'indisponible';
      verdict = 'SKIPPED';
      reason = 'Quota API épuisé : collecte suspendue. État technique, pas disparition d’avions.';
      success = t(30);
    }
    return { ...s, state, state_detail: reason, verdict, verdict_reason: reason, last_attempt: attempt, last_success: success, last_novelty: novelty };
  });
}

/* ---------- Seuils de la jauge, notifications ---------- */

export const PLAN_THRESHOLDS: ThresholdItem[] = [
  { key: "anomaly_mad_k", label: "Écart de détection d'anomalie", description: "Une mesure est anormale au-delà de ce nombre de dispersions robustes (MAD) par rapport à sa référence. Réglage expérimental du plan (§5), pas un seuil scientifiquement validé.", unit: "dispersions", plan_value: 3, value: 3, min: 2, max: 6, step: 0.5, affects: "Détection d'anomalie des séries numériques (non branchée au lot 3 : aucune série collectée)" },
  { key: "anomaly_windows", label: "Durée minimale d'une anomalie", description: "Nombre de fenêtres consécutives pendant lesquelles l'écart doit durer.", unit: "fenêtres", plan_value: 3, value: 3, min: 1, max: 8, step: 1, affects: "Détection d'anomalie des séries numériques (non branchée au lot 3)" },
  { key: "origins_for_25", label: "Origines indépendantes pour le palier 25", description: "Sans preuve directe, nombre minimal d'origines réellement indépendantes rapportant le fait (§6.3).", unit: "origines", plan_value: 2, value: 2, min: 2, max: 4, step: 1, affects: "Palier 25 et au-dessus" },
  { key: "events_for_40", label: "Événements matériels distincts pour le palier 40", description: "Même zone, même fenêtre (§6.3).", unit: "événements", plan_value: 2, value: 2, min: 2, max: 5, step: 1, affects: "Palier 40" },
  { key: "families_for_40", label: "Familles d'indicateurs pour le palier 40", description: "Familles distinctes (autorités, faits régionaux, mesure technique…).", unit: "familles", plan_value: 2, value: 2, min: 2, max: 4, step: 1, affects: "Palier 40" },
  { key: "downgrade_evals", label: "Réévaluations stables avant une baisse", description: "Un retour sous un seuil doit rester stable pendant ce nombre de réévaluations (§6.4). Les hausses graves ne sont jamais retardées ; une correction factuelle s'applique immédiatement.", unit: "réévaluations", plan_value: 2, value: 2, min: 1, max: 6, step: 1, affects: "Baisses de palier" },
  { key: "weak_signal_expiry_h", label: "Expiration d'un signal faible", description: "Durée avant qu'un signal faible n'expire. L'expiration n'établit pas le retour à la normale. Les paliers 70, 85 et 100 n'expirent jamais d'eux-mêmes : ils ne baissent que sur résolution documentée.", unit: "heures", plan_value: 168, value: 168, min: 24, max: 720, step: 24, affects: "Paliers 10 et 25" },
  { key: "coverage_families", label: "Familles obligatoires pour autoriser le palier 0", description: "Profil de couverture du pilote (§6.4) : en dessous, l'indice est « non calculable », jamais 0. Si la valeur dépasse le nombre de familles du profil, le palier 0 devient inatteignable (choix prudent).", unit: "familles", plan_value: 3, value: 3, min: 3, max: 6, step: 1, affects: "Palier 0 / état non calculable" },
  { key: "baseline_weeks", label: "Référence minimale", description: "Semaines de collecte réelle nécessaires avant d'autoriser « 0 » ; sinon « référence insuffisante » (§5). Aucun historique n'est fabriqué.", unit: "semaines", plan_value: 8, value: 8, min: 4, max: 12, step: 1, affects: "Couverture (référence quantitative) et détection d'anomalie" },
  { key: "convergence_window_h", label: "Fenêtre de convergence", description: "Deux événements ne convergent que s'ils sont séparés de moins que cette durée.", unit: "heures", plan_value: 72, value: 72, min: 24, max: 168, step: 24, affects: "Palier 40 et 55" },
  { key: "coverage_freshness_h", label: "Fraîcheur maximale d'une source essentielle", description: "Une source essentielle est « à jour » si son dernier succès date de moins que cette durée (ou si son secours l'est).", unit: "heures", plan_value: 6, value: 6, min: 1, max: 48, step: 1, affects: "Couverture" },
];

/** Définitions des 8 paliers, telles que le backend les publie (config/index-scale.yaml). */
export const PALIER_DEFS = [
  { value: 0 as const, label: "Aucun signal qualifiant observé", definition: "Couverture de référence satisfaite ; aucun critère actif, aucune situation majeure non résolue. Ne prouve ni la paix ni un risque nul." },
  { value: 10 as const, label: "Signal isolé", definition: "Observation pertinente vérifiable, insuffisante pour distinguer incident ordinaire et tension ; la pure rhétorique est plafonnée ici." },
  { value: 25 as const, label: "Tension documentée", definition: "Acte matériel ou mesure concrète de tension, lié au périmètre et documenté (preuve directe, ou plusieurs origines indépendantes) ; pas seulement davantage d'articles." },
  { value: 40 as const, label: "Convergence préoccupante", definition: "Plusieurs événements matériels distincts, plusieurs familles d'indicateurs, origines indépendantes, même zone et même fenêtre ; une explication commune ordinaire ne suffit pas à tout expliquer." },
  { value: 55 as const, label: "Préparation à une crise majeure", definition: "Changement matériel de posture publiquement documenté ET mesure civile ou diplomatique de précaution liée ; l'alternative exercice/défense est examinée." },
  { value: 70 as const, label: "Action hostile grave documentée", definition: "Acte hostile grave contre la zone établi (faits, zone, période, acteur documentés séparément) après validation humaine ; ni simple panne ni simple accusation." },
  { value: 85 as const, label: "Attaque armée directe établie", definition: "Au moins une attaque armée directe par un État ou une force étatique sur la zone, établie après validation humaine ; caractère durable non établi." },
  { value: 100 as const, label: "Conflit armé direct en cours", definition: "Hostilités étatiques organisées et durables établies dans la zone (campagne de frappes ou engagements corroborés) ; l'indice sature." },
];

/** Simule l'indicateur de configuration serveur `pilot_frozen` : gelé par défaut ; `?pilot_frozen=0` le lève (maquette seulement). */
function pilotFrozen(): boolean {
  return typeof window === 'undefined' ? true : new URLSearchParams(window.location.search).get('pilot_frozen') !== '0';
}

function thresholds(scn: string): ThresholdsState {
  const items = PLAN_THRESHOLDS.map((x) => ({ ...x }));
  const pilot_frozen = pilotFrozen();
  if (scn !== 'seuils' && scn !== 'methode') return { policy_version: 'seuils-v1', plan_version: 'seuils-v1', pilot_frozen, items, history: [] };
  if (scn === 'methode') {
    // v2 : essai (2,5), v3 : retour aux valeurs du plan — les seuils sont conformes au plan, mais deux changements de version ont eu lieu
    return {
      policy_version: 'seuils-v3',
      plan_version: 'seuils-v1',
      pilot_frozen,
      items,
      history: [
        { id: 'T-2', at: t(3 * 24), kind: 'retour_plan', key: 'anomaly_mad_k', label: items[0].label, from: 2.5, to: 3, reason: 'Retour aux valeurs du plan après essai', actor: 'David', policy_version: 'seuils-v3' },
        { id: 'T-1', at: t(6 * 24), kind: 'modification', key: 'anomaly_mad_k', label: items[0].label, from: 3, to: 2.5, reason: 'Essai : détection plus précoce', actor: 'David', policy_version: 'seuils-v2' },
      ],
    };
  }
  const set = (k: string, v: number) => (items.find((x) => x.key === k)!.value = v);
  set('anomaly_mad_k', 2.5);
  set('downgrade_evals', 1);
  const history: ThresholdChange[] = [
    { id: 'T-2', at: t(2 * 24), kind: 'modification', key: 'downgrade_evals', label: 'Réévaluations stables avant une baisse', from: 2, to: 1, reason: 'Essai : réduire les oscillations constatées sur la mesure Internet.', actor: 'David', policy_version: 'seuils-v3' },
    { id: 'T-1', at: t(5 * 24), kind: 'modification', key: 'anomaly_mad_k', label: 'Écart de détection d’anomalie', from: 3, to: 2.5, reason: 'Essai : détecter plus tôt les chutes de connectivité.', actor: 'David', policy_version: 'seuils-v2' },
  ];
  return { policy_version: 'seuils-v3', plan_version: 'seuils-v1', pilot_frozen, items, history };
}

const NOTIFICATIONS: NotificationSettings = { enabled: false, silent_until_pilot_end: true, level: 'officiel_a3', channel: 'telegram', channel_state: 'non_active', editable: true };

/* ---------- Historique en escalier ---------- */

interface Step {
  daysAgo: number;
  palier: Palier;
}

function history(steps: Step[], gaps: [number, number][], policy: (daysAgo: number) => string): HistoryPoint[] {
  const pts: HistoryPoint[] = [];
  for (let h = 30 * 24; h >= 0; h -= 6) {
    const d = h / 24;
    const inGap = gaps.some(([from, to]) => d <= from && d > to);
    const step = [...steps].sort((a, b) => b.daysAgo - a.daysAgo).filter((s) => s.daysAgo >= d).pop();
    pts.push({ at: t(h), palier: inGap ? null : (step?.palier ?? 0), policy_version: policy(d) });
  }
  return pts;
}

const STEPS_NOMINAL: Step[] = [
  { daysAgo: 30, palier: 0 },
  { daysAgo: 22, palier: 10 },
  { daysAgo: 16, palier: 0 },
  { daysAgo: 9, palier: 10 },
  { daysAgo: 6, palier: 25 },
  { daysAgo: 1.1, palier: 40 },
];
const GAP_COLLECT: [number, number][] = [[12.5, 11]];

/* ---------- Jauge ---------- */

function gaugeBase(over: Partial<GaugeState>): GaugeState {
  return {
    territory: { id: 'flanc-est', label: 'Flanc est de l’Europe' },
    status: 'calculable',
    palier: 40,
    last_known: null,
    partial_coverage: false,
    as_of: t(0.1),
    trend_24h: { direction: 'hausse', from: 25, to: 40 },
    trend_7d: { direction: 'hausse', from: 10, to: 40 },
    policy: { version: 'seuils-v1', plan_version: 'seuils-v1', label: 'Seuils seuils-v1 (valeurs du plan)' },
    rule_id: 'R-P40',
    rules_version: 'gauge-1.0',
    ...over,
  };
}

function coverage(over: Partial<Coverage> = {}): Coverage {
  return {
    profile_satisfied: true,
    profile_label: 'Profil pilote : 3 familles obligatoires à jour + référence quantitative suffisante',
    families: [
      { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '3 sources sur 4 à jour (1 bloquée, secours actif)' },
      { id: 'faits', label: 'Faits régionaux corroborables', state: 'ok', detail: '2 sources sur 2 à jour' },
      { id: 'technique', label: 'Mesure technique', state: 'ok', detail: 'IODA à jour ; aviation en retard (secours)' },
    ],
    pending_documents: 1,
    pending_major_review: 0,
    baseline: { sufficient: true, detail: 'Référence de 10 semaines comparables' },
    reasons: [],
    ...over,
  };
}

function counters(events: VeilleEvent[]): Counters {
  const excluded = events.filter((e) => e.exclusion);
  const by: Record<ExclusionReason, number> = { doublon: 0, hors_perimetre: 0, perime: 0, preuve_insuffisante: 0 };
  excluded.forEach((e) => (by[e.exclusion!.reason] += 1));
  const unique = events.filter((e) => e.exclusion?.reason !== 'doublon').length;
  return {
    documents_collected: events.reduce((n, e) => n + e.sources.length, 0) + 38,
    unique_events: unique,
    excluded: excluded.length,
    retained: events.filter((e) => !e.exclusion && e.reading_status === 'retenu').length,
    excluded_by_reason: by,
  };
}

const AI: AiState = {
  mode: 'a_la_demande',
  budget_exhausted: false,
  available: true,
  estimate: {
    max_cost_usd: 0.18,
    scope_current: 'Dossier actuel seulement : faits, sources originales, mesures, règles et hypothèses alternatives.',
    scope_extended: 'Inclure une recherche supplémentaire : le modèle propose des recherches, les collecteurs autorisés les exécutent (bornées en nombre, durée et coût).',
  },
  monthly_cap_usd: 4,
  monthly_used_usd: 0,
  previous_runs: [],
};

function journal(extra: JournalEntry[] = []): JournalEntry[] {
  const base: JournalEntry[] = [
    { id: 'J-12', at: t(2.9), kind: 'revue', text: 'Document EV-8 placé en file de qualification (texte non interprété).', simulated: false },
    { id: 'J-11', at: t(7.5), kind: 'evenement', text: 'EV-5 : affirmation non corroborée, trois reprises rattachées à une seule origine.', simulated: false },
    { id: 'J-10', at: t(13.8), kind: 'evenement', text: 'EV-3 : changement de substance relevé sur un conseil aux voyageurs.', simulated: false },
    { id: 'J-09', at: t(24), kind: 'palier', text: 'Passage du palier 25 au palier 40 (deux familles d’indicateurs, origines indépendantes).', simulated: false },
    { id: 'J-08', at: t(24), kind: 'notification', text: 'Notification A2 « analyse approfondie » — SIMULÉE, aucun envoi réel.', simulated: true },
    { id: 'J-07', at: t(28.5), kind: 'evenement', text: 'EV-1 : restriction aérienne temporaire retenue dans l’analyse.', simulated: false },
    { id: 'J-06', at: t(11), kind: 'source', text: 'Agrégat aviation : couverture réduite à 62 %, conclusion de variation suspendue.', simulated: false },
    { id: 'J-05', at: t(6 * 24), kind: 'palier', text: 'Passage du palier 10 au palier 25 (mesure concrète de tension).', simulated: false },
    { id: 'J-04', at: t(9 * 24), kind: 'palier', text: 'Passage du palier 0 au palier 10 (signal isolé).', simulated: false },
    { id: 'J-03', at: t(12.5 * 24), kind: 'source', text: 'Panne du collecteur : intervalle sans mesure (courbe interrompue, pas de valeur 0).', simulated: false },
    { id: 'J-02', at: t(16 * 24), kind: 'palier', text: 'Retour au palier 0 : signal faible expiré selon la durée versionnée (expiration ≠ retour à la normale établi).', simulated: false },
  ];
  return [...extra, ...base].sort((a, b) => b.at.localeCompare(a.at));
}

const CONCLUSION_BASE: Conclusion = {
  template_version: 'gabarit-v1',
  orientation: { text: 'un durcissement des précautions documenté', hypothesis_id: 'H3' },
  evidence_ids: ['EV-1', 'EV-3'],
  trend: { period: '7 jours', direction: 'hausse' },
  alternative: { text: 'Une activité d’exercice (H0)', missing_discriminant: 'le calendrier de l’exercice annoncé ne précise pas la zone de la restriction' },
  ambiguous: false,
};

/* ---------- Assemblage ---------- */

/** L'« histoire » d'un scénario, racontée pour son territoire de référence (voir STORY_TERRITORY). */
function buildStory(scenarioId: string): Snapshot {
  const scn = SCENARIOS.some((s) => s.id === scenarioId) ? scenarioId : 'nominal';
  let events: VeilleEvent[] = BASE_EVENTS.map((e) => ({ ...e }));
  let hyp = hypothesesNominal;
  let g = gaugeBase({});
  let conclusion: Conclusion = CONCLUSION_BASE;
  let cov = coverage();
  let hist = history(STEPS_NOMINAL, GAP_COLLECT, () => 'seuils-v1');
  let methodChanges: MethodChange[] = [];
  let civil: Snapshot['civil_alert'] = null;
  let nuclear: Snapshot['nuclear'] = null;
  let dossierTitle: string | undefined;
  let extraJournal: JournalEntry[] = [];

  switch (scn) {
    case 'indisponible': {
      g = gaugeBase({
        status: 'non_calculable',
        palier: null,
        last_known: { palier: 25, at: t(18) },
        trend_24h: { direction: 'non_comparable', from: null, to: null, reason: 'indice non calculable' },
        trend_7d: { direction: 'non_comparable', from: null, to: null, reason: 'indice non calculable' },
      });
      hyp = hypothesesNominal.map((x) => ({ ...x, verdict: 'donnees_insuffisantes' as const }));
      conclusion = {
        ...CONCLUSION_BASE,
        orientation: null,
        alternative: null,
        ambiguous: true,
        suspended_reason: 'Couverture insuffisante : la famille « mesure technique » est indisponible. La conclusion est suspendue ; elle ne vaut ni zéro ni rassurance.',
        evidence_ids: [],
      };
      cov = coverage({
        profile_satisfied: false,
        families: [
          { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '3 sources sur 4 à jour (1 bloquée, secours actif)' },
          { id: 'faits', label: 'Faits régionaux corroborables', state: 'ok', detail: '2 sources sur 2 à jour' },
          { id: 'technique', label: 'Mesure technique', state: 'indisponible', detail: 'IODA et agrégat aviation indisponibles — aucun secours' },
        ],
      });
      hist = history(STEPS_NOMINAL.slice(0, 5), [...GAP_COLLECT, [0.75, -1]], () => 'seuils-v1');
      extraJournal = [{ id: 'J-13', at: t(0.5), kind: 'source', text: 'Profil de couverture non satisfait : indice courant non calculable (jauge grisée, dernière valeur conservée).', simulated: false }];
      break;
    }
    case 'ambigu': {
      hyp = hypothesesAmbigu;
      conclusion = {
        ...CONCLUSION_BASE,
        orientation: null,
        evidence_ids: ['EV-1', 'EV-2', 'EV-3', 'EV-4'],
        alternative: null,
        ambiguous: true,
      };
      break;
    }
    case 'civile': {
      events = [FLOOD_EVENT, ...BASE_EVENTS.filter((e) => !['EV-1', 'EV-2', 'EV-3', 'EV-5', 'EV-6'].includes(e.id))];
      g = gaugeBase({ palier: 10, trend_24h: { direction: 'stable', from: 10, to: 10 }, trend_7d: { direction: 'stable', from: 10, to: 10 } });
      hyp = [
        H({ id: 'H1', label: 'Incident technique / météo', verdict: 'soutenue', supports: ['Inondation reconnue par la protection civile (EV-101)'], contradicts: [], missing: [], evidence_ids: ['EV-101'] }),
        H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé (EV-4)'], contradicts: [], missing: [], evidence_ids: ['EV-4'] }),
        H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'contredite', supports: [], contradicts: ['Cause météo établie par l’autorité pour EV-101'], missing: [], evidence_ids: ['EV-101'] }),
      ];
      conclusion = {
        template_version: 'gabarit-v1',
        orientation: { text: 'un événement météorologique civil, sans lien avec une confrontation armée', hypothesis_id: 'H1' },
        evidence_ids: ['EV-101'],
        trend: { period: '7 jours', direction: 'stable' },
        alternative: null,
        ambiguous: false,
      };
      hist = history([{ daysAgo: 30, palier: 0 }, { daysAgo: 20, palier: 10 }], GAP_COLLECT, () => 'seuils-v1');
      civil = {
        title: 'Alerte civile — crues majeures, vigilance rouge',
        detail: 'Évacuations préventives dans trois communes du Sud-Est. Cette alerte est indépendante de l’indice de confrontation armée, qui reste bas.',
        issuer: 'Protection civile (fictive)',
        instruction_url: 'https://exemple.invalid/consigne-crues',
        since: t(4.5),
      };
      dossierTitle = 'Perturbation majeure de services civils — crues';
      break;
    }
    case 'nucleaire': {
      g = gaugeBase({ palier: 25, trend_24h: { direction: 'stable', from: 25, to: 25 }, trend_7d: { direction: 'hausse', from: 10, to: 25 } });
      conclusion = { ...CONCLUSION_BASE, orientation: { text: 'une tension documentée sans convergence suffisante pour le palier suivant', hypothesis_id: 'H3' }, evidence_ids: ['EV-1'] };
      events = BASE_EVENTS.filter((e) => e.id !== 'EV-2').map((e) => ({ ...e }));
      nuclear = {
        kind: 'alerte_radiologique',
        scope: 'Zone industrielle étrangère proche de la frontière — hors territoire évalué',
        source: 'Autorité de sûreté nucléaire (fictive)',
        status: 'Alerte radiologique locale, mesures en cours. Aucun emploi d’arme nucléaire établi.',
        instructions: 'Consigne officielle : suivre les communications de l’autorité ; aucune mesure de protection requise sur le territoire évalué.',
      };
      break;
    }
    case 'methode': {
      methodChanges = [
        { at: t(6 * 24), from_version: 'seuils-v1', to_version: 'seuils-v2', note: 'Essai : détection plus précoce', handling: 'tendance_suspendue' },
        { at: t(3 * 24), from_version: 'seuils-v2', to_version: 'seuils-v3', note: 'Retour aux valeurs du plan après essai', handling: 'tendance_suspendue' },
      ];
      g = gaugeBase({
        policy: { version: 'seuils-v3', plan_version: 'seuils-v1', label: 'Seuils seuils-v3 (valeurs du plan)' },
        trend_24h: { direction: 'stable', from: 40, to: 40 },
        trend_7d: { direction: 'non_comparable', from: 10, to: 40, reason: 'seuils modifiés entre-temps (seuils-v1 → seuils-v3)' },
      });
      conclusion = { ...CONCLUSION_BASE, trend: { period: '7 jours', direction: 'non_comparable' } };
      hist = history(STEPS_NOMINAL, GAP_COLLECT, (d) => (d > 6 ? 'seuils-v1' : d > 3 ? 'seuils-v2' : 'seuils-v3'));
      extraJournal = [
        { id: 'J-14', at: t(3 * 24), kind: 'methode', text: 'Changement de version des seuils seuils-v2 → seuils-v3 (retour aux valeurs du plan). Tendance suspendue : un changement de méthode n’est pas une évolution réelle.', simulated: false },
      ];
      break;
    }
    case 'seuils': {
      methodChanges = [
        { at: t(5 * 24), from_version: 'seuils-v1', to_version: 'seuils-v2', note: 'Essai : détecter plus tôt les chutes de connectivité.', handling: 'tendance_suspendue' },
        { at: t(2 * 24), from_version: 'seuils-v2', to_version: 'seuils-v3', note: 'Essai : réduire les oscillations constatées sur la mesure Internet.', handling: 'tendance_suspendue' },
      ];
      hist = history(STEPS_NOMINAL, GAP_COLLECT, (d) => (d > 5 ? 'seuils-v1' : d > 2 ? 'seuils-v2' : 'seuils-v3'));
      g = gaugeBase({
        policy: { version: 'seuils-v3', plan_version: 'seuils-v1', label: 'Seuils seuils-v3 (modifiés)' },
        trend_7d: { direction: 'non_comparable', from: 10, to: 40, reason: 'seuils modifiés entre-temps (seuils-v1 → seuils-v3)' },
      });
      conclusion = { ...CONCLUSION_BASE, trend: { period: '7 jours', direction: 'non_comparable' } };
      extraJournal = [
        { id: 'J-15', at: t(2 * 24), kind: 'methode', text: 'Seuil « Réévaluations stables avant une baisse » : 2 → 1 (seuils-v3). Historique moins comparable.', simulated: false },
        { id: 'J-16', at: t(5 * 24), kind: 'methode', text: 'Seuil « Écart de détection d’anomalie » : 3 → 2,5 (seuils-v2). Historique moins comparable.', simulated: false },
      ];
      break;
    }
    case 'partielle': {
      events = [GRAVE_EVENT, ...BASE_EVENTS.filter((e) => ['EV-3', 'EV-4', 'EV-8', 'EV-9', 'EV-10', 'EV-11', 'EV-12'].includes(e.id))];
      g = gaugeBase({
        palier: 70,
        partial_coverage: true,
        trend_24h: { direction: 'hausse', from: 25, to: 70 },
        trend_7d: { direction: 'hausse', from: 10, to: 70 },
      });
      hyp = [
        H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'soutenue', supports: ['Cause hostile établie par une autorité (EV-102)'], contradicts: ['Attribution étatique non établie'], missing: ['Attribution confirmée', 'Attaque armée directe'], evidence_ids: ['EV-102'] }),
        H({ id: 'H1', label: 'Incident technique / météo', verdict: 'contredite', supports: [], contradicts: ['Dégradation volontaire constatée (EV-102)'], missing: [], evidence_ids: ['EV-102'] }),
        H({ id: 'H2', label: 'Intimidation / dissuasion', verdict: 'compatible', supports: [], contradicts: [], missing: ['Revendication ou déclaration officielle'], evidence_ids: [] }),
      ];
      conclusion = {
        template_version: 'gabarit-v1',
        orientation: { text: 'un acte hostile grave documenté, dont l’attribution n’est pas établie', hypothesis_id: 'H4' },
        evidence_ids: ['EV-102'],
        trend: { period: '24 heures', direction: 'hausse' },
        alternative: { text: 'Une action sans lien étatique (H2)', missing_discriminant: 'aucune attribution n’est confirmée par une autorité' },
        ambiguous: false,
      };
      cov = coverage({
        profile_satisfied: false,
        families: [
          { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '3 sources sur 4 à jour (1 bloquée, secours actif)' },
          { id: 'faits', label: 'Faits régionaux corroborables', state: 'degrade', detail: '1 source sur 2 à jour' },
          { id: 'technique', label: 'Mesure technique', state: 'indisponible', detail: 'Collecteur IODA en panne, sans rapport avec le fait' },
        ],
      });
      hist = history([...STEPS_NOMINAL.slice(0, 5), { daysAgo: 0.3, palier: 70 }], GAP_COLLECT, () => 'seuils-v1');
      break;
    }
  }

  const paliers = PALIER_DEFS;
  return {
    scenario_id: scn,
    as_of: NOW,
    last_collect: t(0.1),
    territories: TERRITORIES,
    gauge: g,
    coverage: cov,
    criteria: criteriaFor(g.palier, events),
    paliers,
    conclusion,
    hypotheses: hyp,
    events,
    counters: counters(events),
    dossiers: dossiers(hyp, dossierTitle),
    history: hist,
    method_changes: methodChanges,
    sources: sources(scn),
    reviews: reviewsFor(events),
    journal: journal(extraJournal),
    journal_partial: false,
    civil_alert: civil,
    nuclear,
    ai: scn === 'ambigu' ? { ...AI, previous_runs: [] } : AI,
    thresholds: thresholds(scn),
    notifications: { ...NOTIFICATIONS },
    demo: true,
  };
}

/* ---------- Territoires (comme le backend : config/territories.yaml) ---------- */

export const TERRITORIES: Territory[] = [
  { id: 'FR', label: 'France (métropole et outre-mer)', zones: ['FR'], default: true },
  { id: 'flanc-est', label: 'Flanc est de l’Europe', zones: ['EE', 'LT', 'LV', 'BY', 'MD', 'PL', 'RU', 'UA'], default: false },
];

/** Territoire sur lequel chaque scénario raconte son histoire (les autres territoires sont « calmes »). */
export const STORY_TERRITORY: Record<string, string> = { civile: 'FR', partielle: 'FR' };
export const storyTerritoryOf = (scenarioId: string): string => STORY_TERRITORY[scenarioId] ?? 'flanc-est';

/** Comme `GET /events?territory=` : événements dont la zone est dans le territoire, plus ceux sans zone connue. */
const inTerritory = (e: VeilleEvent, terr: Territory): boolean => e.zone_code == null || terr.zones.includes(e.zone_code);

const DEF_BY_VALUE = new Map<number, (typeof PALIER_DEFS)[number]>(PALIER_DEFS.map((d) => [d.value, d]));

/** Critères des 8 paliers (`gauge/detail.criteria`) : rempli / non rempli / non évalué + événements. */
function criteriaFor(palier: Palier | null, events: VeilleEvent[]): Criterion[] {
  return PALIER_DEFS.map((d) => {
    const ids = events.filter((e) => !e.exclusion && e.effect.palier === d.value && e.effect.state === 'rempli').map((e) => Number(e.id.slice(3)));
    let state: Criterion['state'];
    let note: string;
    if (palier === null) {
      state = 'non_evalue';
      note = 'Couverture insuffisante : critère non évalué (jamais assimilé à « non rempli »).';
    } else if (d.value === 0) {
      state = palier === 0 ? 'rempli' : 'non_rempli';
      note = palier === 0 ? 'Couverture satisfaite, aucun critère actif.' : 'Au moins un critère est actif.';
    } else if (d.value >= 85 && palier < d.value) {
      state = 'non_evalue';
      note = 'Aucune revue humaine ne qualifie ce palier.';
    } else {
      state = d.value <= palier ? 'rempli' : 'non_rempli';
      note = state === 'rempli' ? `${ids.length} événement(s) satisfont ce critère.` : 'Conditions non réunies.';
    }
    return { palier: d.value, criterion: DEF_BY_VALUE.get(d.value)!.label, state, note, event_ids: state === 'rempli' ? ids : [] };
  });
}

/** `GET /reviews?status=open` : événements à qualifier. */
function reviewsFor(events: VeilleEvent[]): ReviewItem[] {
  const out: ReviewItem[] = [];
  const ev5 = events.find((e) => e.id === 'EV-5');
  const ev8 = events.find((e) => e.id === 'EV-8');
  if (ev5) out.push({ id: 1, kind: 'claim_qualification', document_id: null, claim_id: 106, event_id: 'EV-5', reason: 'Qualification hostile issue de prose : revue humaine obligatoire', status: 'open', created_at: t(7.5) });
  if (ev8) out.push({ id: 2, kind: 'unqualified_document', document_id: 801, claim_id: null, event_id: 'EV-8', reason: 'Texte non interprété par le moteur : à qualifier', status: 'open', created_at: t(2.9) });
  return out;
}

/** Territoire sans histoire propre : seuls ses événements comptent ; pas de conclusion (le moteur d'hypothèses n'existe pas encore côté serveur). */
function quiet(story: Snapshot, terr: Territory): Snapshot {
  const events = story.events.filter((e) => inTerritory(e, terr));
  const calculable = story.gauge.status === 'calculable';
  const live = events.filter((e) => !e.exclusion);
  const p: Palier | null = !calculable ? null : live.some((e) => e.reading_status === 'retenu' && e.effect.state === 'rempli') ? 25 : live.some((e) => e.reading_status !== 'contexte' || e.effect.palier >= 10) ? 10 : 0;
  const gauge: GaugeState = {
    ...story.gauge,
    territory: { id: terr.id, label: terr.label },
    palier: p,
    partial_coverage: false,
    trend_24h: p === null ? story.gauge.trend_24h : { direction: 'stable', from: p, to: p },
    trend_7d: p === null ? story.gauge.trend_7d : { direction: 'stable', from: p, to: p },
    rule_id: p === null ? 'R-NC' : `R-P${p}`,
  };
  const points = story.history.map((h) => ({ ...h, palier: h.palier === null || p === null ? null : p, status: h.palier === null || p === null ? ('non_calculable' as const) : ('calculable' as const) }));
  return {
    ...story,
    gauge,
    events,
    counters: counters(events),
    criteria: criteriaFor(p, events),
    conclusion: story.conclusion?.suspended_reason ? story.conclusion : null,
    hypotheses: [],
    dossiers: story.dossiers.map((d) => {
      const ids = d.event_ids.filter((id) => events.some((e) => e.id === `EV-${id}`));
      return {
        ...d,
        zone: terr.label,
        state: !calculable && ids.length === 0 ? ('indetermine' as const) : ids.length ? ('actif' as const) : ('veille' as const),
        summary: ids.length ? `${ids.length} événement(s) retenu(s) dans la fenêtre de ${d.horizon}.` : calculable ? `Aucun événement retenu sur ${d.horizon}.` : 'Données insuffisantes pour conclure.',
        event_ids: ids,
        rule_interpretation: { conclusion: ids.length ? `${ids.length} événement(s) retenu(s) dans la fenêtre.` : calculable ? `Aucun événement retenu sur ${d.horizon}.` : 'Données insuffisantes pour conclure.', supports: [], contradicts: [], missing: ['Moteur d’hypothèses non implémenté (lot 3, reste à faire)'], hypotheses: [] },
      };
    }),
    history: points,
    reviews: reviewsFor(events),
  };
}

/**
 * Instantané d'un territoire, comme l'API le renverrait : seuls les événements de ses zones comptent (« une attaque en Ukraine
 * n'est pas une attaque en France »). `territoryId` absent = territoire par défaut (FR).
 */
export function buildSnapshot(scenarioId: string, territoryId?: string): Snapshot {
  const story = buildStory(scenarioId);
  const terr = TERRITORIES.find((x) => x.id === territoryId) ?? TERRITORIES.find((x) => x.default)!;
  const home = TERRITORIES.find((x) => x.id === storyTerritoryOf(story.scenario_id))!;
  if (terr.id !== home.id) return quiet(story, terr);
  const events = story.events.filter((e) => inTerritory(e, terr));
  return {
    ...story,
    gauge: { ...story.gauge, territory: { id: terr.id, label: terr.label } },
    events,
    counters: counters(events),
    criteria: criteriaFor(story.gauge.palier, events),
    reviews: reviewsFor(events),
    dossiers: story.dossiers.map((d) => ({ ...d, zone: terr.label, event_ids: d.event_ids.filter((id) => events.some((e) => e.id === `EV-${id}`)) })),
  };
}
