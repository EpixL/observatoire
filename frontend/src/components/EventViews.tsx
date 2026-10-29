import type { Counters, ExclusionReason, ReadingStatus, VeilleEvent } from '../types';
import { fmt, fmtFull } from '../lib/format';
import { LAYERS, LayerSymbol } from './LayerSymbol';
import type { MapViewId } from '../lib/geo';

export const READING: Record<ReadingStatus, string> = { retenu: 'Retenu dans l’analyse', contexte: 'Contexte', a_verifier: 'À vérifier' };
const EVIDENCE: Record<VeilleEvent['evidence_status'], string> = {
  directe: 'Preuve directe',
  deux_origines: 'Deux origines indépendantes',
  origine_unique: 'Origine unique',
  non_corroboree: 'Non corroborée',
};
const EXCL: Record<ExclusionReason, string> = { doublon: 'Doublon', hors_perimetre: 'Hors périmètre', perime: 'Données périmées', preuve_insuffisante: 'Preuve insuffisante' };
const PRECISION: Record<VeilleEvent['occurred_precision'], string> = { minute: 'à la minute', heure: 'à l’heure près', jour: 'au jour près', inconnue: 'date inconnue' };
const layerLabel = (id: string) => LAYERS.find((l) => l.id === id)!.label;

export function StatusBadge({ e }: { e: VeilleEvent }) {
  if (e.exclusion) return <span className="badge excl">Exclu · {EXCL[e.exclusion.reason]}</span>;
  return <span className={`badge ${e.reading_status}`}>{READING[e.reading_status]}</span>;
}

function EventButton({ e, selected, onSelect }: { e: VeilleEvent; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="ev-btn" aria-pressed={selected} onClick={() => onSelect(e.id)} data-testid={`ev-${e.id}`}>
        <span className="t">
          <span className="mono muted">{e.id}</span> {e.title}
        </span>
        <span className="s">
          <StatusBadge e={e} />
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <LayerSymbol layer={e.layer} className="sym" /> {layerLabel(e.layer).split(' / ')[0]}
          </span>
          <span className="num">{fmt(e.published_at ?? e.first_seen_at)}</span>
        </span>
      </button>
    </li>
  );
}

interface ListProps {
  events: VeilleEvent[]; // filtrés
  counters: Counters;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Liste accessible de boutons, synchronisée avec la carte : même sélection, même fiche. */
export function EventList({ events, counters, selectedId, onSelect }: ListProps) {
  const localised = events.filter((e) => !e.exclusion && e.location.kind === 'point');
  const unlocated = events.filter((e) => !e.exclusion && e.location.kind === 'none');
  const excluded = events.filter((e) => e.exclusion);
  return (
    <section className="panel" aria-labelledby="list-title" data-testid="event-list">
      <div className="list-head">
        <h2 id="list-title" style={{ margin: 0 }}>
          Éléments traités
        </h2>
      </div>
      <div className="counters" role="group" aria-label="Compteur de traitement" style={{ marginTop: 8 }}>
        <div>
          <b>{counters.documents_collected}</b>
          <span>documents collectés</span>
        </div>
        <div>
          <b>{counters.unique_events}</b>
          <span>événements uniques</span>
        </div>
        <div>
          <b>{counters.excluded}</b>
          <span>exclusions</span>
        </div>
      </div>
      <p className="subhead">Localisés ({localised.length})</p>
      {localised.length ? (
        <ul className="ev-list">
          {localised.map((e) => (
            <EventButton key={e.id} e={e} selected={e.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      ) : (
        <p className="empty">Aucun élément localisé avec ces filtres.</p>
      )}
      <p className="subhead" data-testid="unlocated-head">
        Non localisé ({unlocated.length})
      </p>
      {unlocated.length ? (
        <ul className="ev-list">
          {unlocated.map((e) => (
            <EventButton key={e.id} e={e} selected={e.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      ) : (
        <p className="empty">Aucun.</p>
      )}
      {excluded.length > 0 && (
        <>
          <p className="subhead">Exclus de l’analyse ({excluded.length}) — inspectables avec leur motif</p>
          <ul className="ev-list">
            {excluded.map((e) => (
              <EventButton key={e.id} e={e} selected={e.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        </>
      )}
      {!excluded.length && counters.excluded > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {counters.excluded} élément{counters.excluded > 1 ? 's' : ''} exclu{counters.excluded > 1 ? 's' : ''} masqué{counters.excluded > 1 ? 's' : ''} (doublon {counters.excluded_by_reason.doublon}, hors périmètre{' '}
          {counters.excluded_by_reason.hors_perimetre}, périmé {counters.excluded_by_reason.perime}, preuve insuffisante {counters.excluded_by_reason.preuve_insuffisante}). Activez « Afficher les éléments exclus ».
        </p>
      )}
    </section>
  );
}

interface CardProps {
  event: VeilleEvent | null;
  view: MapViewId;
  offView: boolean;
  onGoEurope: () => void;
  onOpenDossier: (id: string) => void;
}

const EFFECT: Record<VeilleEvent['effect']['state'], string> = { rempli: 'Critère rempli', non_rempli: 'Critère non rempli', non_evalue: 'Critère non évalué' };
const EFFECT_SYM: Record<VeilleEvent['effect']['state'], string> = { rempli: '✔', non_rempli: '✖', non_evalue: '?' };

export function EventCard({ event: e, offView, onGoEurope, onOpenDossier }: CardProps) {
  if (!e) {
    return (
      <section className="panel card" aria-live="polite" data-testid="event-card">
        <h2>Fiche de l’élément sélectionné</h2>
        <p className="empty">Sélectionnez un marqueur sur la carte ou un élément dans la liste pour voir ses sources, son statut de preuve et son effet exact sur le palier.</p>
      </section>
    );
  }
  const origins = new Set(e.sources.map((s) => s.origin_id)).size;
  return (
    <section className="panel card" aria-live="polite" aria-labelledby="card-title" data-testid="event-card">
      <h2>Fiche de l’élément sélectionné</h2>
      <div className="badges">
        <StatusBadge e={e} />
        <span className="badge">{EVIDENCE[e.evidence_status]}</span>
        {e.sources.some((s) => s.official) && <span className="badge official">Source officielle</span>}
        <span className="badge fictif">Donnée fictive</span>
      </div>
      <h3 id="card-title">
        <span className="mono muted">{e.id}</span> {e.title}
      </h3>
      {offView && (
        <p className="off-view">
          Cet élément n’est pas visible dans la vue actuelle de la carte.{' '}
          <button type="button" className="btn link" onClick={onGoEurope}>
            Passer à la vue Europe
          </button>
        </p>
      )}
      {e.exclusion && (
        <p className="notice">
          <b>Exclu de l’analyse — {EXCL[e.exclusion.reason]}.</b> {e.exclusion.detail}
        </p>
      )}
      <p>{e.observed_fact}</p>
      <dl>
        <dt>Survenue</dt>
        <dd>
          {e.occurred_at ? (
            <time dateTime={e.occurred_at} title={fmtFull(e.occurred_at)}>
              {fmt(e.occurred_at)}
            </time>
          ) : (
            'inconnue'
          )}{' '}
          <span className="muted">({PRECISION[e.occurred_precision]})</span>
        </dd>
        <dt>Publication</dt>
        <dd>{e.published_at ? <time dateTime={e.published_at} title={fmtFull(e.published_at)}>{fmt(e.published_at)}</time> : 'inconnue (date non annoncée par l’éditeur)'}</dd>
        <dt>Première observation</dt>
        <dd>
          <time dateTime={e.first_seen_at} title={fmtFull(e.first_seen_at)}>{fmt(e.first_seen_at)}</time> <span className="muted">(collecte : {fmt(e.retrieved_at)})</span>
        </dd>
        <dt>Expiration</dt>
        <dd>{e.expires_at ? fmt(e.expires_at) : 'aucune'}</dd>
        <dt>Localisation</dt>
        <dd>{e.location.kind === 'point' ? e.location.label : `Non localisé — ${e.location.reason}`}</dd>
        <dt>Couche</dt>
        <dd>{layerLabel(e.layer)}</dd>
        <dt>Règle</dt>
        <dd className="mono">
          {e.rule.id} v{e.rule.version}
        </dd>
      </dl>

      <h4 className="subhead">
        Sources ({e.sources.length}) · {origins} origine{origins > 1 ? 's' : ''} indépendante{origins > 1 ? 's' : ''}
      </h4>
      {e.sources.map((s) => (
        <div key={s.id} className="src">
          <b>{s.name}</b>{' '}
          <span className="badge">{s.is_original ? 'Source originale' : 'Reprise'}</span> {s.official && <span className="badge official">Officielle</span>}
          <blockquote>« {s.excerpt} »</blockquote>
          <span className="muted" style={{ fontSize: 13 }}>
            Publié {s.published_at ? fmt(s.published_at) : 'date inconnue'} · collecté {fmt(s.retrieved_at)} ·{' '}
            <a href={s.url} onClick={(ev) => ev.preventDefault()}>
              lien original (factice)
            </a>
          </span>
        </div>
      ))}
      {origins < e.sources.length && (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
          Plusieurs reprises d’une même origine ne comptent pas comme des confirmations indépendantes.
        </p>
      )}

      {e.hypotheses.length > 0 && (
        <>
          <h4 className="subhead">Hypothèses compatibles</h4>
          <ul>{e.hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>
        </>
      )}
      {e.contradictions.length > 0 && (
        <>
          <h4 className="subhead">Contradictions</h4>
          <ul>{e.contradictions.map((h) => <li key={h}>{h}</li>)}</ul>
        </>
      )}

      <div className="effect">
        <div>
          <span className={`st ${e.effect.state}`}>
            {EFFECT_SYM[e.effect.state]} {EFFECT[e.effect.state]}
          </span>{' '}
          — palier <b className="num">{e.effect.palier}</b> : {e.effect.criterion}
        </div>
        <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>
          {e.effect.note}
        </p>
      </div>
      {e.dossier_ids.length > 0 && (
        <p style={{ marginTop: 10 }}>
          {e.dossier_ids.map((d) => (
            <button key={d} type="button" className="btn" onClick={() => onOpenDossier(d)} style={{ marginRight: 6 }}>
              Ouvrir le dossier {d}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
