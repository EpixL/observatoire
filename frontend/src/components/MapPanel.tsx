import { useMemo } from 'react';
import type { LayerId, VeilleEvent } from '../types';
import { MapSvg } from './MapSvg';
import { LAYERS, LayerSymbol } from './LayerSymbol';
import {
  MAP_H,
  MAP_W,
  OVERSEAS,
  OVERSEAS_H,
  OVERSEAS_W,
  VIEWS,
  backdropFor,
  franceMetropole,
  overseasFeatures,
  overseasProjection,
  projectionFor,
  type MapViewId,
} from '../lib/geo';
import { WINDOWS, type Filters, type TimeWindow } from '../lib/filters';
import { useMedia } from '../hooks/useMedia';

interface Props {
  view: MapViewId;
  onView: (v: MapViewId) => void;
  overseas: boolean;
  onOverseas: (b: boolean) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  events: VeilleEvent[]; // déjà filtrés
  totalEvents: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCluster: (ids: string[]) => void;
  clusterIds: string[];
  eventsById: Record<string, VeilleEvent>;
  tall?: boolean;
}

export function MapPanel(p: Props) {
  const wide = useMedia('(min-width: 1100px)');
  const { filters, onFilters } = p;
  const showOverseas = p.view === 'france' && p.overseas;
  const proj = useMemo(() => projectionFor(p.view), [p.view]);
  const backdrop = useMemo(() => backdropFor(p.view), [p.view]);
  const focus = useMemo(() => (p.view === 'france' ? [franceMetropole()] : []), [p.view]);
  const caption = VIEWS.find((v) => v.id === p.view)!.caption;
  const visibleCount = p.events.filter((e) => e.location.kind === 'point').length;
  const toggleLayer = (id: LayerId) => {
    const layers = new Set(filters.layers);
    if (layers.has(id)) layers.delete(id);
    else layers.add(id);
    onFilters({ ...filters, layers });
  };

  const layersPanel = (
    <details className="layers" open={wide ? true : undefined} data-testid="layers-panel">
      <summary>
        Couches et filtres ({filters.layers.size}/5)
        <span className="sr-only">
          (touchez pour déplier)
        </span>
      </summary>
      <div className="grp" role="group" aria-label="Couches sélectionnables">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            type="button"
            className="btn layer-btn"
            aria-pressed={l.connector ? filters.layers.has(l.id) : false}
            disabled={!l.connector}
            onClick={() => toggleLayer(l.id)}
            aria-describedby={`hint-${l.id}`}
            data-testid={`layer-${l.id}`}
          >
            <LayerSymbol layer={l.id} className="sym" />
            <span>
              {l.label}
              <small id={`hint-${l.id}`} className="hint">{l.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <details className="fold">
        <summary>Précautions d’interprétation</summary>
        <ul className="muted" style={{ fontSize: 13, margin: '0 0 6px 18px', padding: 0 }}>
          {LAYERS.map((l) => (
            <li key={l.id}>
              <b>{l.label} :</b> {l.hint}
            </li>
          ))}
        </ul>
      </details>
      <h3>Période affichée</h3>
      <div className="seg" role="group" aria-label="Période affichée">
        {WINDOWS.map((w) => (
          <button key={w.id} type="button" className="btn" aria-pressed={filters.window === w.id} onClick={() => onFilters({ ...filters, window: w.id as TimeWindow })}>
            {w.label}
          </button>
        ))}
      </div>
      <h3>Lecture</h3>
      <div className="grp">
        <button type="button" className="btn layer-btn" aria-pressed={filters.onlyRetained} onClick={() => onFilters({ ...filters, onlyRetained: !filters.onlyRetained })}>
          Éléments retenus dans l’évaluation seulement
        </button>
        <button type="button" className="btn layer-btn" aria-pressed={filters.showExcluded} onClick={() => onFilters({ ...filters, showExcluded: !filters.showExcluded })}>
          Afficher les éléments exclus
        </button>
      </div>
      <p className="note">
        Ces filtres n’affectent que l’affichage. Masquer une couche ne retire pas ses preuves du moteur. Changer le périmètre d’analyse est une commande distincte.
      </p>
    </details>
  );

  return (
    <section className="panel map-panel" aria-labelledby="map-title" data-testid="map-panel">
      <h2 id="map-title" className="sr-only">
        Carte des événements
      </h2>
      <div className="map-top">
        <div className="seg" role="group" aria-label="Vue de la carte">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className="btn" aria-pressed={p.view === v.id} onClick={() => p.onView(v.id)} data-testid={`view-${v.id}`}>
              {v.label}
            </button>
          ))}
        </div>
        {p.view === 'france' && (
          <div className="seg" role="group" aria-label="Zone de la vue France">
            <button type="button" className="btn" aria-pressed={!p.overseas} onClick={() => p.onOverseas(false)} data-testid="view-metropole">
              Métropole
            </button>
            <button type="button" className="btn" aria-pressed={p.overseas} onClick={() => p.onOverseas(true)} data-testid="view-outremer">
              Outre-mer
            </button>
          </div>
        )}
        <span className="counter num" aria-live="polite">
          {visibleCount} localisé{visibleCount > 1 ? 's' : ''} sur {p.totalEvents} élément{p.totalEvents > 1 ? 's' : ''}
        </span>
      </div>

      <div className={wide ? 'map-with-panel' : undefined}>
        {layersPanel}
        <div>
          <div className="map-frame">
            <span className="map-badge">Données fictives</span>
            {showOverseas ? (
              <div className="overseas" data-testid="overseas">
                {OVERSEAS.map((o) => (
                  <OverseasFigure key={o.id} panel={o} {...p} />
                ))}
              </div>
            ) : (
              <MapSvg
                width={MAP_W}
                height={MAP_H}
                projection={proj}
                backdrop={backdrop}
                focus={focus}
                events={p.events}
                selectedId={p.selectedId}
                onSelect={p.onSelect}
                onCluster={p.onCluster}
                graticuleOn={p.view === 'monde'}
                ariaLabel={`Carte ${VIEWS.find((v) => v.id === p.view)!.label} : marqueurs indicatifs. La liste des éléments ci-dessous offre le même accès au clavier.`}
                testId="map-svg"
              />
            )}
          </div>
          {p.clusterIds.length > 1 && (
            <div className="map-caption" data-testid="cluster-box">
              <b>Groupe de {p.clusterIds.length} événements uniques</b> (pas d’articles) :{' '}
              {p.clusterIds.map((id) => (
                <button key={id} type="button" className="btn link" onClick={() => p.onSelect(id)}>
                  {id}
                </button>
              ))}
            </div>
          )}
          <div className="map-caption">
            <div className="legend" aria-label="Légende des symboles">
              {LAYERS.filter((l) => l.connector).map((l) => (
                <span key={l.id}>
                  <LayerSymbol layer={l.id} className="sym" /> {l.label.split(' / ')[0]}
                </span>
              ))}
              <span>Anneau pointillé = position indicative</span>
              <span>Plein = retenu · creux = contexte · tirets ambre = à vérifier</span>
            </div>
            <p style={{ marginTop: 4 }}>{caption} Positions indicatives à l’échelle des pays, aucune coordonnée précise. Aucune ligne causale entre événements proches. Fond : Natural Earth (domaine public), hors ligne.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function OverseasFigure({ panel, events, selectedId, onSelect, onCluster }: Props & { panel: (typeof OVERSEAS)[number] }) {
  const projection = useMemo(() => overseasProjection(panel), [panel]);
  const focus = useMemo(() => overseasFeatures(panel), [panel]);
  return (
    <figure>
      <figcaption>{panel.label}</figcaption>
      <MapSvg
        width={OVERSEAS_W}
        height={OVERSEAS_H}
        projection={projection}
        backdrop={[]}
        focus={focus}
        events={events}
        selectedId={selectedId}
        onSelect={onSelect}
        onCluster={onCluster}
        small
        ariaLabel={`Vignette ${panel.label}`}
        testId={`overseas-${panel.id}`}
      />
    </figure>
  );
}
