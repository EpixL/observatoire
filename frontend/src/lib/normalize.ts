import type { EventLocation, Snapshot, VeilleEvent } from '../types';
import { DISPLAY_OVERRIDES, ZONES, zoneName } from './zones';

/** « EV-12 » reste « EV-12 » ; l'entier 12 devient « EV-12 » (le backend envoie des entiers dans dossiers et critères). */
export const eventId = (x: string | number): string => (typeof x === 'number' ? `EV-${x}` : x);

/**
 * Affichage d'une localisation à partir du CODE de zone (le backend n'envoie que le code, pas un nom) :
 *  - le nom vient de lib/zones.ts ; la précision reste « pays » (échelle du pays), jamais une position précise ;
 *  - `place_code` (sous-zone d'outre-mer, quand le backend le fournira) place le marqueur sur le territoire ;
 *  - la Russie est posée sur l'ouest du pays (décision de David), signalée « échelle région ».
 */
export function normalizeLocation(e: Pick<VeilleEvent, 'location' | 'zone_code' | 'place_code'>): EventLocation {
  const loc = e.location;
  if (loc.kind !== 'point') return loc;
  const code = e.place_code ?? e.zone_code ?? loc.zone_code ?? loc.iso ?? loc.label;
  const override = DISPLAY_OVERRIDES[code];
  if (override) {
    return { kind: 'point', lon: override.center[0], lat: override.center[1], precision: override.precision, label: `${override.name} — position indicative (échelle région)`, iso: code, zone_code: code };
  }
  const z = ZONES[code];
  const [lon, lat] = e.place_code && z ? z.center : [loc.lon, loc.lat];
  const scope = e.place_code ? 'échelle territoire' : 'échelle pays';
  return { kind: 'point', lon, lat, precision: e.place_code ? 'region' : loc.precision, label: `${zoneName(code)} — position indicative (${scope})`, iso: code, zone_code: code };
}

export function normalizeEvent(e: VeilleEvent): VeilleEvent {
  return { ...e, location: normalizeLocation(e) };
}

/** Applique les normalisations d'affichage ; idempotente. Complète `dossier_ids` (le backend renvoie []). */
export function normalizeSnapshot(s: Snapshot): Snapshot {
  const dossiers = s.dossiers.map((d) => ({ ...d, event_ids: d.event_ids.map(eventId) }));
  const events = s.events.map((raw) => {
    const e = normalizeEvent(raw);
    const ids = dossiers.filter((d) => d.event_ids.includes(e.id)).map((d) => d.id);
    return { ...e, dossier_ids: e.dossier_ids.length ? e.dossier_ids : ids };
  });
  return { ...s, dossiers, events, criteria: s.criteria.map((c) => ({ ...c, event_ids: c.event_ids.map(eventId) })) };
}
