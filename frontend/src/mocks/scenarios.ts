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
  Snapshot,
  SourceRecord,
  VeilleEvent,
} from '../types';
import { BASE_EVENTS, FLOOD_EVENT, GRAVE_EVENT, NOW } from './events';

const t = (hoursAgo: number): string => new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString().replace('.000Z', 'Z');
const TERRITORY = { id: 'FR', label: 'France — métropole et outre-mer' };

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
];

/* ---------- Hypothèses ---------- */

const H = (h: Hypothesis): Hypothesis => h;

const hypothesesNominal: Hypothesis[] = [
  H({ id: 'H3', label: 'Préparation défensive / précaution', verdict: 'soutenue', supports: ['Restriction aérienne nouvelle (EV-001)', 'Conseil aux voyageurs renforcé (EV-003)'], contradicts: [], missing: ['Changement de posture militaire publiquement documenté'], evidence_ids: ['EV-001', 'EV-003'] }),
  H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé du 31 octobre au 7 novembre (EV-004)'], contradicts: ['Le calendrier de l’exercice ne couvre pas la zone de la restriction'], missing: ['Calendrier précis de l’exercice et zone exacte'], evidence_ids: ['EV-004'] }),
  H({ id: 'H1', label: 'Incident technique / météo', verdict: 'compatible', supports: ['Cause commune météo non exclue pour la coupure Internet (EV-002)'], contradicts: [], missing: ['Communiqué de l’opérateur sur la cause'], evidence_ids: ['EV-002'] }),
  H({ id: 'H2', label: 'Intimidation / dissuasion', verdict: 'donnees_insuffisantes', supports: [], contradicts: [], missing: ['Déclarations officielles ou signalement de posture'], evidence_ids: [] }),
  H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'donnees_insuffisantes', supports: [], contradicts: ['Aucun acte hostile établi (EV-005 non corroboré)'], missing: ['Acte hostile documenté par une autorité'], evidence_ids: ['EV-005'] }),
];

const hypothesesAmbigu: Hypothesis[] = [
  H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé (EV-004)'], contradicts: [], missing: ['Zone exacte de l’exercice'], evidence_ids: ['EV-004'] }),
  H({ id: 'H1', label: 'Incident technique / météo', verdict: 'compatible', supports: ['Coupure Internet avec météo défavorable (EV-002)'], contradicts: [], missing: ['Cause de la coupure'], evidence_ids: ['EV-002'] }),
  H({ id: 'H2', label: 'Intimidation / dissuasion', verdict: 'compatible', supports: ['Restriction aérienne sans motif (EV-001)'], contradicts: [], missing: ['Posture officielle publiée'], evidence_ids: ['EV-001'] }),
  H({ id: 'H3', label: 'Préparation défensive / précaution', verdict: 'compatible', supports: ['Conseil renforcé (EV-003)'], contradicts: [], missing: ['Mesure de précaution effective liée à la restriction'], evidence_ids: ['EV-003'] }),
  H({ id: 'H4', label: 'Préparation ou réalisation d’une escalade hostile', verdict: 'compatible', supports: [], contradicts: ['Aucun acte hostile établi'], missing: ['Élément discriminant : changement de posture'], evidence_ids: [] }),
];

/* ---------- Dossiers ---------- */

function dossiers(hyp: Hypothesis[], civilTitle?: string): DossierScenario[] {
  return [
    {
      id: 'D-CIV',
      title: civilTitle ?? 'Perturbation majeure de services civils',
      zone: 'Europe centrale et orientale',
      horizon: 'Présent à 72 heures',
      state: 'actif',
      summary: 'Coupures mesurées, opérateurs affectés, durée et étendue.',
      rules_version: 'dossier-civil 1.2',
      rule_interpretation: {
        conclusion: 'Une perturbation réseau partielle est confirmée par deux origines indépendantes ; sa cause reste inconnue. Plusieurs interprétations restent possibles.',
        supports: ['Mesure technique et opérateur concordants (EV-002)'],
        contradicts: ['Panne technique reconnue et rétablie pour un autre territoire (EV-007) : indépendante, sans effet sur ce dossier'],
        missing: ['Cause déclarée par l’opérateur', 'Étendue géographique précise'],
        hypotheses: hyp.filter((x) => ['H1', 'H3'].includes(x.id)),
      },
      event_ids: ['EV-002', 'EV-007'],
      updated_at: t(3),
    },
    {
      id: 'D-REG',
      title: 'Dégradation régionale de sécurité',
      zone: 'Europe — flanc oriental',
      horizon: '7 jours',
      state: 'actif',
      summary: 'Incidents corroborés, restrictions civiles, changements diplomatiques et de posture documentés.',
      rules_version: 'dossier-regional 1.4',
      rule_interpretation: {
        conclusion: 'Durcissement des précautions documenté : restriction aérienne et conseil aux voyageurs renforcé. Cela soutient un changement de comportement ; cela ne démontre pas une préparation offensive.',
        supports: ['Restriction aérienne effective (EV-001)', 'Conseil aux voyageurs renforcé (EV-003)'],
        contradicts: ['Exercice annoncé (EV-004) pouvant expliquer une partie des mesures'],
        missing: ['Changement de posture publiquement documenté', 'Corroboration de l’affirmation de sabotage (EV-005)'],
        hypotheses: hyp,
      },
      event_ids: ['EV-001', 'EV-002', 'EV-003', 'EV-004', 'EV-005', 'EV-006'],
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

type SrcInit = Omit<SourceRecord, 'state' | 'state_detail' | 'last_success' | 'last_novelty'>;
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
  const out: SourceRecord[] = SOURCE_REGISTRY.map((s, i) => {
    let state: SourceRecord['state'] = 'ok';
    let detail = 'À jour dans les délais attendus.';
    let success: string | null = t(0.1 + i * 0.05);
    let novelty: string | null = t(2 + i * 3);
    if (s.id === 'S-AVIA') {
      state = 'retard';
      detail = 'Quota partiellement consommé : cadence réduite (couverture 62 %).';
      success = t(1.2);
      novelty = t(11);
    }
    if (scn === 'indisponible' && s.id === 'S-IODA') {
      state = 'indisponible';
      detail = 'Échec de connexion depuis 18 h. Dernier succès conservé ; aucune ancienne observation n’est présentée comme un flux en direct.';
      success = t(18);
    }
    if (scn === 'indisponible' && s.id === 'S-AVIA') {
      state = 'indisponible';
      detail = 'Quota API épuisé : état technique, pas disparition d’avions.';
      success = t(30);
    }
    return { ...s, state, state_detail: detail, last_success: success, last_novelty: novelty };
  });
  return out;
}

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
    territory: TERRITORY,
    status: 'calculable',
    palier: 40,
    last_known: null,
    partial_coverage: false,
    as_of: t(0.1),
    trend_24h: { direction: 'hausse', from: 25, to: 40 },
    trend_7d: { direction: 'hausse', from: 10, to: 40 },
    policy: { version: 'echelle-v1.2', label: 'Échelle de situation, règles v1.2' },
    ...over,
  };
}

function coverage(over: Partial<Coverage> = {}): Coverage {
  return {
    profile_satisfied: true,
    profile_label: 'Profil France — pilote',
    families: [
      { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '4 sources sur 4 à jour' },
      { id: 'faits', label: 'Faits régionaux corroborables', state: 'ok', detail: '2 sources sur 2 à jour' },
      { id: 'technique', label: 'Mesure technique', state: 'ok', detail: 'IODA à jour ; aviation en retard (secours)' },
    ],
    pending_documents: 1,
    pending_major_review: 0,
    baseline: { sufficient: true, detail: 'Référence de 10 semaines comparables' },
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
    { id: 'J-12', at: t(2.9), kind: 'revue', text: 'Document EV-008 placé en file de qualification (texte non interprété).', simulated: false },
    { id: 'J-11', at: t(7.5), kind: 'evenement', text: 'EV-005 : affirmation non corroborée, trois reprises rattachées à une seule origine.', simulated: false },
    { id: 'J-10', at: t(13.8), kind: 'evenement', text: 'EV-003 : changement de substance relevé sur un conseil aux voyageurs.', simulated: false },
    { id: 'J-09', at: t(24), kind: 'palier', text: 'Passage du palier 25 au palier 40 (deux familles d’indicateurs, origines indépendantes).', simulated: false },
    { id: 'J-08', at: t(24), kind: 'notification', text: 'Notification A2 « analyse approfondie » — SIMULÉE, aucun envoi réel.', simulated: true },
    { id: 'J-07', at: t(28.5), kind: 'evenement', text: 'EV-001 : restriction aérienne temporaire retenue dans l’analyse.', simulated: false },
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
  evidence_ids: ['EV-001', 'EV-003'],
  trend: { period: '7 jours', direction: 'hausse' },
  alternative: { text: 'Une activité d’exercice (H0)', missing_discriminant: 'le calendrier de l’exercice annoncé ne précise pas la zone de la restriction' },
  ambiguous: false,
};

/* ---------- Assemblage ---------- */

export function buildSnapshot(scenarioId: string): Snapshot {
  const scn = SCENARIOS.some((s) => s.id === scenarioId) ? scenarioId : 'nominal';
  let events: VeilleEvent[] = BASE_EVENTS.map((e) => ({ ...e }));
  let hyp = hypothesesNominal;
  let g = gaugeBase({});
  let conclusion: Conclusion = CONCLUSION_BASE;
  let cov = coverage();
  let hist = history(STEPS_NOMINAL, GAP_COLLECT, () => 'echelle-v1.2');
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
          { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '4 sources sur 4 à jour' },
          { id: 'faits', label: 'Faits régionaux corroborables', state: 'ok', detail: '2 sources sur 2 à jour' },
          { id: 'technique', label: 'Mesure technique', state: 'indisponible', detail: 'IODA et agrégat aviation indisponibles — aucun secours' },
        ],
      });
      hist = history(STEPS_NOMINAL.slice(0, 5), [...GAP_COLLECT, [0.75, -1]], () => 'echelle-v1.2');
      extraJournal = [{ id: 'J-13', at: t(0.5), kind: 'source', text: 'Profil de couverture non satisfait : indice courant non calculable (jauge grisée, dernière valeur conservée).', simulated: false }];
      break;
    }
    case 'ambigu': {
      hyp = hypothesesAmbigu;
      conclusion = {
        ...CONCLUSION_BASE,
        orientation: null,
        evidence_ids: ['EV-001', 'EV-002', 'EV-003', 'EV-004'],
        alternative: null,
        ambiguous: true,
      };
      break;
    }
    case 'civile': {
      events = [FLOOD_EVENT, ...BASE_EVENTS.filter((e) => !['EV-001', 'EV-002', 'EV-003', 'EV-005', 'EV-006'].includes(e.id))];
      g = gaugeBase({ palier: 10, trend_24h: { direction: 'stable', from: 10, to: 10 }, trend_7d: { direction: 'stable', from: 10, to: 10 } });
      hyp = [
        H({ id: 'H1', label: 'Incident technique / météo', verdict: 'soutenue', supports: ['Inondation reconnue par la protection civile (EV-101)'], contradicts: [], missing: [], evidence_ids: ['EV-101'] }),
        H({ id: 'H0', label: 'Activité habituelle / exercice', verdict: 'compatible', supports: ['Exercice annoncé (EV-004)'], contradicts: [], missing: [], evidence_ids: ['EV-004'] }),
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
      hist = history([{ daysAgo: 30, palier: 0 }, { daysAgo: 20, palier: 10 }], GAP_COLLECT, () => 'echelle-v1.2');
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
      conclusion = { ...CONCLUSION_BASE, orientation: { text: 'une tension documentée sans convergence suffisante pour le palier suivant', hypothesis_id: 'H3' }, evidence_ids: ['EV-001'] };
      events = BASE_EVENTS.filter((e) => e.id !== 'EV-002').map((e) => ({ ...e }));
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
      const change: MethodChange = {
        at: t(3 * 24),
        from_version: 'echelle-v1.1',
        to_version: 'echelle-v1.2',
        note: 'Nouvelle pondération de la famille « mesure technique » (durée minimale 3 → 4 fenêtres).',
        handling: 'tendance_suspendue',
      };
      methodChanges = [change];
      g = gaugeBase({
        trend_24h: { direction: 'non_comparable', from: null, to: null, reason: 'changement de méthode il y a 3 jours' },
        trend_7d: { direction: 'non_comparable', from: null, to: null, reason: 'règles différentes sur la période' },
      });
      conclusion = { ...CONCLUSION_BASE, trend: { period: '7 jours', direction: 'non_comparable' } };
      hist = history(STEPS_NOMINAL, GAP_COLLECT, (d) => (d > 3 ? 'echelle-v1.1' : 'echelle-v1.2'));
      extraJournal = [{ id: 'J-14', at: t(3 * 24), kind: 'methode', text: 'Changement de méthode echelle-v1.1 → v1.2. Tendance suspendue : une nouvelle pondération n’est pas une dégradation réelle.', simulated: false }];
      break;
    }
    case 'partielle': {
      events = [GRAVE_EVENT, ...BASE_EVENTS.filter((e) => ['EV-003', 'EV-004', 'EV-008', 'EV-009', 'EV-010', 'EV-011', 'EV-012'].includes(e.id))];
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
          { id: 'autorites', label: 'Autorités / mesures', state: 'ok', detail: '4 sources sur 4 à jour' },
          { id: 'faits', label: 'Faits régionaux corroborables', state: 'degrade', detail: '1 source sur 2 à jour' },
          { id: 'technique', label: 'Mesure technique', state: 'indisponible', detail: 'Collecteur IODA en panne, sans rapport avec le fait' },
        ],
      });
      hist = history([...STEPS_NOMINAL.slice(0, 5), { daysAgo: 0.3, palier: 70 }], GAP_COLLECT, () => 'echelle-v1.2');
      break;
    }
  }

  return {
    scenario_id: scn,
    as_of: NOW,
    last_collect: t(0.1),
    gauge: g,
    coverage: cov,
    conclusion,
    hypotheses: hyp,
    events,
    counters: counters(events),
    dossiers: dossiers(hyp, dossierTitle),
    history: hist,
    method_changes: methodChanges,
    sources: sources(scn),
    journal: journal(extraJournal),
    civil_alert: civil,
    nuclear,
    ai: scn === 'ambigu' ? { ...AI, previous_runs: [] } : AI,
    demo: true,
  };
}
