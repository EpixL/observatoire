import { useState } from 'react';
import type { JournalEntry, SourceRecord } from '../types';
import { fmt } from '../lib/format';

const STATE_LABEL = { ok: 'À jour', retard: 'En retard', indisponible: 'Indisponible' } as const;
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
        {(['tous', 'ok', 'retard', 'indisponible'] as const).map((k) => (
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
              <span className={`chip ${s.state === 'ok' ? 'ok' : s.state === 'retard' ? 'watch' : 'grave'}`}>
                {s.state === 'ok' ? '●' : s.state === 'retard' ? '◐' : '○'} {STATE_LABEL[s.state]}
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

const J_KIND: Record<JournalEntry['kind'], string> = { palier: 'Palier', methode: 'Méthode', source: 'Source', evenement: 'Événement', notification: 'Notification', revue: 'Revue' };

export function Journal({ entries }: { entries: JournalEntry[] }) {
  const [kind, setKind] = useState<'tous' | JournalEntry['kind']>('tous');
  const shown = entries.filter((e) => kind === 'tous' || e.kind === kind);
  return (
    <section className="panel" aria-labelledby="jr-title" data-testid="journal">
      <h2 id="jr-title">Journal des changements</h2>
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
