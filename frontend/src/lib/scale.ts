import type { Palier, Trend, TrendInfo } from '../types';

export interface PalierDef {
  value: Palier;
  label: string;
  criteria: string;
}

/** Les huit paliers de la V1 — libellés et conditions reprises de docs/PLAN.md §6.3 (propositions à tester). */
export const PALIERS: PalierDef[] = [
  { value: 0, label: 'Aucun signal qualifiant observé', criteria: 'Couverture de référence satisfaite ; aucun critère actif, aucune situation majeure non résolue. Cela ne prouve ni la paix ni un risque nul.' },
  { value: 10, label: 'Signal isolé', criteria: 'Observation pertinente vérifiable, mais insuffisante pour distinguer incident ordinaire et tension. La pure rhétorique est plafonnée ici.' },
  { value: 25, label: 'Tension documentée', criteria: 'Acte matériel ou mesure concrète de tension, lié au périmètre et documenté — pas seulement davantage d’articles.' },
  { value: 40, label: 'Convergence préoccupante', criteria: 'Au moins deux événements matériels distincts, deux familles d’indicateurs, origines indépendantes, même zone et même fenêtre ; les explications ordinaires ne suffisent pas à tout expliquer.' },
  { value: 55, label: 'Préparation à une crise majeure', criteria: 'Changement matériel de posture publiquement documenté ET mesure civile ou diplomatique de précaution liée au même dossier ; l’alternative exercice / défense est examinée.' },
  { value: 70, label: 'Action hostile grave documentée', criteria: 'Acte hostile grave contre la zone établi, cause hostile et gravité étayées, sans qualifier encore un conflit armé direct. Une simple panne est exclue.' },
  { value: 85, label: 'Attaque armée directe établie', criteria: 'Au moins une attaque armée directe par un État ou une force étatique sur la zone, avec éléments suffisants ; caractère durable non établi.' },
  { value: 100, label: 'Conflit armé direct en cours', criteria: 'Hostilités étatiques organisées et durables établies dans la zone ; campagne de frappes ou engagements corroborés au-delà d’un seul incident isolé.' },
];

export const PALIER_VALUES: Palier[] = PALIERS.map((p) => p.value);

/** Graduations imprimées sur le cadran (§10) : 0–25–55–85–100. Les huit paliers restent les seules valeurs affichables. */
export const GRADUATIONS = [0, 25, 55, 85, 100] as const;

export function palierDef(p: Palier): PalierDef {
  return PALIERS.find((d) => d.value === p)!;
}

export function palierLabel(p: Palier): string {
  return palierDef(p).label;
}

/** Ton visuel : cyan = données, ambre = vigilance, rouge = faits graves documentés (≥ 70). La couleur ne remplace jamais le libellé. */
export type Tone = 'neutral' | 'data' | 'watch' | 'grave';
export function palierTone(p: Palier | null): Tone {
  if (p === null) return 'neutral';
  if (p <= 25) return 'data';
  if (p <= 55) return 'watch';
  return 'grave';
}

/** « passage du palier 25 au palier 40 » — jamais de pourcentage. */
export function trendSentence(t: TrendInfo, period: string): string {
  switch (t.direction) {
    case 'hausse':
    case 'baisse':
      return `Sur ${period} : passage du palier ${t.from} au palier ${t.to}.`;
    case 'stable':
      return `Sur ${period} : même palier (${t.to ?? '—'}). « Stable » ne démontre pas un risque constant.`;
    case 'non_comparable':
      return `Sur ${period} : tendance non comparable${t.reason ? ` — ${t.reason}` : ''}.`;
  }
}

export const trendWord: Record<Trend, string> = {
  hausse: 'en hausse',
  stable: 'stable (même palier)',
  baisse: 'en baisse',
  non_comparable: 'non comparable',
};

/** Angle sur le cadran : arc de 270°, de −135° à +135° depuis le haut, linéaire en valeur. */
export const GAUGE_SWEEP = 270;
export function palierAngle(value: number): number {
  return -GAUGE_SWEEP / 2 + (value / 100) * GAUGE_SWEEP;
}
