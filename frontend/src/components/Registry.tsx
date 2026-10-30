import { useState } from 'react';
import type { JournalEntry, ReviewItem, SourceRecord } from '../types';
import { fmt } from '../lib/format';

const STATE_LABEL = { ok: 'À jour', retard: 'En retard', indisponible: 'Indisponible', desactivee: 'Désactivée' } as const;
const KIND = { mesure: 'Mesure', operateur: 'Opérateur', autorite: 'Autorité', media: 'Média' } as const;

export function Sources({ list, now }: { list: SourceRecord[]; now: string }) {
  const [only, setOnly] = useState<'tous' | SourceRecord['state']>('tous');
  const shown = list.filter((s) => only === 'tous' || s.state === only);
  return (
    <section className="panel" aria-labelledby="src-title" data-testid="sources">
      <h2 id="src-title">Registre des sources</h2>
      <p className="muted" style={{ marginBottom: 10 }}>
        États de connecteurs fictifs. Un flux indisponible reste visible ; aucune ancienne observation n’est présentée comme un flux en direct. Au {fmt(now)}.
      </p>
      <div className="filters" role="group" aria-label="Filtrer par état">
        {(['tous', 'ok', 'retard', 'indisponible', 'desactivee'] as const).map((k) => (
          <button key={k} type="button" className="btn" aria-pressed={only === k} onClick={() => setOnly(k)}>
            {k === 'tous' ? `Tous (${list.length})` : `${STATE_LABEL[k]} (${list.filter((s) => s.state === k).length})`}
          </button>
        ))}
      </div>
      <div className="src-grid">
        {shown.map((s) => (
          <article key={s.id} className="src-row">
            <h3>
              {s.name} <span className="muted">— {s.organism}</span>
            </h3>
            <p>
              <span className={`chip ${s.state === 'ok' ? 'ok' : s.state === 'retard' ? 'watch' : s.state === 'indisponible' ? 'grave' : ''}`}>
                {s.state === 'ok' ? '●' : s.state === 'retard' ? '◐' : s.state === 'indisponible' ? '○' : '–'} {STATE_LABEL[s.state]}
              </span>{' '}
              <span className="chip">{KIND[s.kind]}</span> <span className="chip">{s.family}</span>
            </p>
            <p className="muted">{s.state_detail}</p>
            <dl>
              <dt>Dernier succès</dt>
              <dd>{s.last_success ? fmt(s.last_success) : 'aucun'}</dd>
              <dt>Dernière nouveauté</dt>
              <dd>{s.last_novelty ? fmt(s.last_novelty) : 'aucune'}</dd>
              <dt>Zone</dt>
              <dd>{s.zone}</dd>
              <dt>Accès</dt>
              <dd>
                {s.access} · cadence {s.frequency} · délai attendu {s.expected_delay}
              </dd>
              <dt>Licence</dt>
              <dd>{s.licence}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

const J_KIND: Record<JournalEntry['kind'], string> = { palier: 'Palier', methode: 'Méthode / seuils', source: 'Source', evenement: 'Événement', notification: 'Notification', revue: 'Revue' };

const REVIEW_KIND: Record<string, string> = {
  claim_qualification: 'Qualification hostile à valider',
  unqualified_document: 'Document à qualifier',
  prompt_injection_suspected: 'Instruction suspecte dans un document',
  possible_same_origin: 'Origine commune possible',
  attribution_without_event: 'Attribution sans événement',
};

export function Journal({ entries, partial, reviews, onSelectEvent }: { entries: JournalEntry[]; partial: boolean; reviews: ReviewItem[]; onSelectEvent: (id: string) => void }) {
  const [kind, setKind] = useState<'tous' | JournalEntry['kind']>('tous');
  const shown = entries.filter((e) => kind === 'tous' || e.kind === kind);
  return (
    <section className="panel" aria-labelledby="jr-title" data-testid="journal">
      <h2 id="jr-title">Journal des changements</h2>
      {partial && (
        <p className="notice" style={{ marginBottom: 10 }} data-testid="journal-partial">
          Journal partiel : le serveur n’expose pas encore de route de journal. Seuls les changements de seuils (réels, datés) sont listés ; les mouvements de palier, de sources et d’événements ne le sont pas.
        </p>
      )}
      <section aria-labelledby="rv-title" data-testid="reviews" style={{ marginBottom: 14 }}>
        <h3 id="rv-title" className="subhead">File de revue humaine ({reviews.length})</h3>
        {reviews.length === 0 ? (
          <p className="empty">Rien à qualifier.</p>
        ) : (
          <ul className="ev-list">
            {reviews.map((r) => (
              <li key={r.id}>
                <button type="button" className="ev-btn" disabled={!r.event_id} onClick={() => r.event_id && onSelectEvent(r.event_id)}>
                  <span className="t">{REVIEW_KIND[r.kind] ?? r.kind}</span>
                  <span className="s">
                    <span>{r.reason}</span>
                    {r.event_id && <span className="mono">{r.event_id}</span>}
                    <span className="num">{fmt(r.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Qualifier un événement (palier 70 et au-dessus) se fait par une revue humaine ; elle n’est pas encore saisissable depuis cet écran.
        </p>
      </section>
      <p className="muted" style={{ marginBottom: 10 }}>
        Permet de reconstruire le dossier au moment d’une alerte. Les notifications sont simulées : rien n’est envoyé.
      </p>
      <div className="filters" role="group" aria-label="Filtrer par type">
        {(['tous', ...Object.keys(J_KIND)] as ('tous' | JournalEntry['kind'])[]).map((k) => (
          <button key={k} type="button" className="btn" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'tous' ? 'Tout' : J_KIND[k]}
          </button>
        ))}
      </div>
      <ol className="journal">
        {shown.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at} className="num">{fmt(e.at)}</time>
            <span>
              <span className="chip">{J_KIND[e.kind]}</span>{' '}
              {e.simulated && <span className="chip watch">Simulé</span>} {e.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
