const TZ = 'Europe/Paris';

const dtf = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dtfFull = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const dfShort = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: 'short' });

/** Tout est stocké en UTC ; affichage Europe/Paris avec fuseau (§4 du plan). */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return 'inconnue';
  return dtf.format(new Date(iso)).replace(',', '');
}
export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return 'inconnue';
  return dtfFull.format(new Date(iso));
}
export function fmtDay(iso: string): string {
  return dfShort.format(new Date(iso));
}

/** Âge relatif par rapport à une horloge donnée (jamais Date.now() : la maquette est figée). */
export function ago(iso: string, now: string): string {
  const min = Math.round((Date.parse(now) - Date.parse(iso)) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
