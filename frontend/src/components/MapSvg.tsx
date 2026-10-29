import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, Geometry } from 'geojson';
import type { GeoProjection } from 'd3-geo';
import type { VeilleEvent } from '../types';
import { cluster, graticule, pathFor, type RegionProps } from '../lib/geo';
import { shapePath } from './LayerSymbol';

interface Props {
  width: number;
  height: number;
  projection: GeoProjection;
  /** Entités de fond (voisins). */
  backdrop: Feature<Geometry, RegionProps>[];
  /** Entités mises en avant (ex. métropole). */
  focus?: Feature<Geometry, RegionProps>[];
  events: VeilleEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCluster?: (ids: string[]) => void;
  graticuleOn?: boolean;
  ariaLabel: string;
  testId?: string;
  /** Marqueurs plus petits dans les vignettes outre-mer. */
  small?: boolean;
}

export function useScale(width: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setScale(w / width);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

/**
 * Carte SVG hors-ligne. Aucun marqueur n'est relié à un autre par une ligne causale.
 * Les marqueurs sont indicatifs (échelle pays ou région) : anneau en pointillés. La navigation clavier passe par la liste d'éléments.
 */
export function MapSvg({ width, height, projection, backdrop, focus = [], events, selectedId, onSelect, onCluster, graticuleOn, ariaLabel, testId, small }: Props) {
  const { ref, scale } = useScale(width);
  const path = useMemo(() => pathFor(projection), [projection]);
  const r = Math.min(Math.max((small ? 5 : 7) / scale, 4), 14);
  const hit = 23 / scale; // ≈ 46 px de diamètre à l'écran → cible tactile ≥ 44 px
  const all = useMemo(() => [...backdrop, ...focus], [backdrop, focus]);

  const placed = useMemo(
    () =>
      events.flatMap((e) => {
        if (e.location.kind !== 'point') return [];
        const p = projection([e.location.lon, e.location.lat]);
        if (!p || p[0] < 0 || p[0] > width || p[1] < 0 || p[1] > height) return [];
        return [{ item: e, x: p[0], y: p[1] }];
      }),
    [events, projection, width, height],
  );
  const groups = useMemo(() => cluster(placed, (small ? 20 : 30) / scale), [placed, scale, small]);

  const haloIsos = new Set(events.filter((e) => e.location.kind === 'point' && e.location.precision === 'pays').map((e) => (e.location as { iso?: string }).iso));
  // pas d'étiquette de pays sous un regroupement : il masquerait le texte
  const clustered = new Set(groups.filter((g) => g.items.length > 1).flatMap((g) => g.items.map((e) => e.id)));
  const labelled = events
    .filter((e) => e.location.kind === 'point' && e.location.iso && e.location.precision === 'pays' && !clustered.has(e.id))
    .map((e) => e.location as { iso: string });

  return (
    <svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={ariaLabel} data-testid={testId}>
      {graticuleOn && <path className="grat" d={path(graticule) ?? ''} />}
      {backdrop.map((f, i) => (
        <path key={`b${i}`} className={`land dim${haloIsos.has(f.properties.i) ? ' halo' : ''}`} d={path(f) ?? ''} />
      ))}
      {focus.map((f, i) => (
        <path key={`f${i}`} className="land" d={path(f) ?? ''} />
      ))}
      {all
        .filter((f) => labelled.some((l) => l.iso === f.properties.i))
        .map((f) => {
          const c = path.centroid(f);
          if (!c || Number.isNaN(c[0])) return null;
          return (
            <text key={`l${f.properties.i}`} className="country-label" x={c[0]} y={c[1] + r + 14 / scale} textAnchor="middle" style={{ fontSize: 11 / scale }}>
              {f.properties.n}
            </text>
          );
        })}
      {groups.map((g, gi) => {
        if (g.items.length === 1) {
          const e = g.items[0];
          const sel = e.id === selectedId;
          const excluded = !!e.exclusion;
          return (
            <g key={e.id} transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)})`} data-event={e.id} aria-hidden="true">
              <circle className="mk-halo" r={r + 6 / scale} />
              {sel && <circle className="mk-sel" r={r + 11 / scale} style={{ strokeWidth: 2.5 / scale }} />}
              <path className={`mk-shape ${excluded ? 'excluded' : e.reading_status}`} d={shapePath(e.layer, r)} style={{ strokeWidth: 2 / scale }} />
              <circle className="mk-hit" r={hit} onClick={() => onSelect(e.id)} data-testid={`marker-${e.id}`} />
            </g>
          );
        }
        const ids = g.items.map((e) => e.id);
        const sel = ids.includes(selectedId ?? '');
        return (
          <g key={`g${gi}`} transform={`translate(${g.x.toFixed(1)} ${g.y.toFixed(1)})`} aria-hidden="true" data-cluster={ids.join(',')}>
            {sel && <circle className="mk-sel" r={r + 11 / scale} style={{ strokeWidth: 2.5 / scale }} />}
            <circle className="mk-cluster" r={r * 1.5} style={{ strokeWidth: 2 / scale }} />
            <text className="mk-count num" style={{ fontSize: 13 / scale }}>
              {g.items.length}
            </text>
            <circle
              className="mk-hit"
              r={hit}
              onClick={() => {
                onSelect(ids[0]);
                onCluster?.(ids);
              }}
              data-testid={`cluster-${ids[0]}`}
            />
          </g>
        );
      })}
    </svg>
  );
}
