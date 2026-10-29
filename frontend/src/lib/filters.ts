import type { LayerId, VeilleEvent } from '../types';

export type TimeWindow = '24h' | '7j' | '30j' | 'tout';
export const WINDOWS: { id: TimeWindow; label: string; hours: number }[] = [
  { id: '24h', label: '24 h', hours: 24 },
  { id: '7j', label: '7 jours', hours: 24 * 7 },
  { id: '30j', label: '30 jours', hours: 24 * 30 },
  { id: 'tout', label: 'Tout', hours: Infinity },
];

export interface Filters {
  layers: Set<LayerId>;
  window: TimeWindow;
  onlyRetained: boolean;
  showExcluded: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  layers: new Set<LayerId>(['restrictions', 'aviation', 'reseaux', 'incidents', 'mesures']),
  window: 'tout',
  onlyRetained: false,
  showExcluded: false,
};

/**
 * Les filtres n'agissent QUE sur l'affichage : masquer une couche ne retire jamais ses preuves du moteur.
 */
export function applyFilters(events: VeilleEvent[], f: Filters, now: string): VeilleEvent[] {
  const hours = WINDOWS.find((w) => w.id === f.window)!.hours;
  return events.filter((e) => {
    if (!f.layers.has(e.layer)) return false;
    if (e.exclusion && !f.showExcluded) return false;
    if (f.onlyRetained && (e.exclusion || e.reading_status !== 'retenu')) return false;
    if (hours !== Infinity) {
      const ref = Date.parse(e.published_at ?? e.first_seen_at);
      if (Date.parse(now) - ref > hours * 3_600_000) return false;
    }
    return true;
  });
}
