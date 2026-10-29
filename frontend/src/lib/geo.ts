import { geoConicConformal, geoMercator, geoNaturalEarth1, geoPath, geoGraticule10, type GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import raw from '../geo/geo.json';

export type MapViewId = 'france' | 'europe' | 'monde';
export type RegionProps = { n: string; i: string };
type FC = FeatureCollection<Geometry, RegionProps>;

const data = raw as unknown as { source: string; world: FC; europe: FC; franceUnits: FC };
export const GEO_SOURCE = data.source;

export const MAP_W = 800;
export const MAP_H = 520;

export const VIEWS: { id: MapViewId; label: string; caption: string }[] = [
  { id: 'france', label: 'France', caption: 'Vue France : métropole ou outre-mer. La métropole ne représente pas la totalité du territoire français.' },
  { id: 'europe', label: 'Europe', caption: 'Vue Europe.' },
  { id: 'monde', label: 'Monde', caption: 'Vue Monde. Changer de vue ne modifie jamais le territoire évalué par la jauge.' },
];

const pad = 18;

export function projectionFor(view: MapViewId | 'metropole', w = MAP_W, h = MAP_H): GeoProjection {
  switch (view) {
    case 'metropole':
    case 'france': {
      const metro = data.franceUnits.features.find((f) => f.properties.i === 'FXX')!;
      return geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent(
        [
          [pad, pad],
          [w - pad, h - pad],
        ],
        metro,
      );
    }
    case 'europe':
      return geoConicConformal().parallels([40, 62]).rotate([-14, 0]).fitExtent(
        [
          [pad, pad],
          [w - pad, h - pad],
        ],
        { type: 'MultiPoint', coordinates: [[-12, 36], [38, 36], [40, 68], [-10, 68], [16, 71]] },
      );
    case 'monde':
      return geoNaturalEarth1().fitExtent(
        [
          [pad, pad],
          [w - pad, h - pad],
        ],
        { type: 'Sphere' },
      );
  }
}

/** Fonds de carte utilisés par vue (voisins estompés + entité mise en avant). */
export function backdropFor(view: MapViewId): Feature<Geometry, RegionProps>[] {
  if (view === 'monde') return data.world.features;
  if (view === 'europe') return data.europe.features;
  // France métropole : voisins d'Europe + métropole
  return data.europe.features.filter((f) => f.properties.i !== 'FRA');
}
export function franceMetropole(): Feature<Geometry, RegionProps> {
  return data.franceUnits.features.find((f) => f.properties.i === 'FXX')!;
}

export interface OverseasPanel {
  id: string;
  label: string;
  units: string[];
}
export const OVERSEAS: OverseasPanel[] = [
  { id: 'antilles', label: 'Antilles', units: ['GLP', 'MTQ', 'MAF', 'BLM'] },
  { id: 'guyane', label: 'Guyane', units: ['GUF'] },
  { id: 'reunion', label: 'La Réunion', units: ['REU'] },
  { id: 'mayotte', label: 'Mayotte', units: ['MYT'] },
  { id: 'spm', label: 'Saint-Pierre-et-Miquelon', units: ['SPM'] },
  { id: 'ncl', label: 'Nouvelle-Calédonie', units: ['NCL'] },
  { id: 'wlf', label: 'Wallis-et-Futuna', units: ['WLF'] },
  { id: 'pyf', label: 'Polynésie française', units: ['PYF'] },
];
export const OVERSEAS_W = 360;
export const OVERSEAS_H = 250;

export function overseasFeatures(p: OverseasPanel): Feature<Geometry, RegionProps>[] {
  return data.franceUnits.features.filter((f) => p.units.includes(f.properties.i));
}
export function overseasProjection(p: OverseasPanel): GeoProjection {
  const fc: FC = { type: 'FeatureCollection', features: overseasFeatures(p) };
  return geoMercator().fitExtent(
    [
      [14, 14],
      [OVERSEAS_W - 14, OVERSEAS_H - 14],
    ],
    fc,
  );
}

export function pathFor(projection: GeoProjection) {
  return geoPath(projection);
}
export const graticule = geoGraticule10();

export interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

/** Regroupe les marqueurs trop proches (en unités du viewBox). Un groupe compte des événements UNIQUES, pas des articles. */
export function cluster<T>(points: Placed<T>[], minDist: number): { x: number; y: number; items: T[] }[] {
  const groups: { x: number; y: number; items: T[] }[] = [];
  for (const p of points) {
    const g = groups.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < minDist);
    if (g) {
      g.items.push(p.item);
      g.x = (g.x * (g.items.length - 1) + p.x) / g.items.length;
      g.y = (g.y * (g.items.length - 1) + p.y) / g.items.length;
    } else groups.push({ x: p.x, y: p.y, items: [p.item] });
  }
  return groups;
}

/** L'événement a-t-il un marqueur visible dans la vue courante ? (sinon la fiche propose de changer de vue) */
export function isInView(e: { location: { kind: string; lon?: number; lat?: number } }, view: MapViewId, overseas: boolean): boolean {
  if (e.location.kind !== 'point') return true;
  const { lon, lat } = e.location as { lon: number; lat: number };
  const inside = (p: [number, number] | null, w: number, h: number) => !!p && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h;
  if (view === 'france' && overseas) {
    return OVERSEAS.some((o) => inside(overseasProjection(o)([lon, lat]), OVERSEAS_W, OVERSEAS_H));
  }
  return inside(projectionFor(view)([lon, lat]), MAP_W, MAP_H);
}
