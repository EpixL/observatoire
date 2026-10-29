import type { Conclusion as ConclusionT, Coverage, Hypothesis } from '../types';
import { trendWord } from '../lib/scale';

const VERDICT: Record<Hypothesis['verdict'], string> = {
  soutenue: 'Soutenue',
  compatible: 'Compatible',
  contredite: 'Contredite',
  donnees_insuffisantes: 'Données insuffisantes',
};

function Refs({ ids, onSelect }: { ids: string[]; onSelect: (id: string) => void }) {
  if (!ids.length) return <>les éléments disponibles</>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === ids.length - 1 ? ' et ' : ', ')}
          <button type="button" className="ref" onClick={() => onSelect(id)} aria-label={`Ouvrir l’élément ${id}`}>
            {id}
          </button>
        </span>
      ))}
    </>
  );
}

/** Conclusion « à gabarit », produite sans IA ; chaque proposition factuelle renvoie à des éléments. */
export function Conclusion({ c, onSelect }: { c: ConclusionT; onSelect: (id: string) => void }) {
  return (
    <section className="panel conclusion" aria-labelledby="concl-title" data-testid="conclusion">
      <h2 id="concl-title">Conclusion automatique · sans IA</h2>
      {c.suspended_reason ? (
        <p>
          <span className="ambig">Conclusion suspendue. </span>
          {c.suspended_reason}
        </p>
      ) : c.ambiguous || !c.orientation ? (
        <p>
          <span className="ambig">Plusieurs interprétations restent possibles.</span> Les éléments disponibles (<Refs ids={c.evidence_ids} onSelect={onSelect} />) ne contiennent pas
          d’élément discriminant que les hypothèses concurrentes n’expliquent pas. Aucune hypothèse dominante n’est annoncée. La tendance sur {c.trend.period} est{' '}
          {trendWord[c.trend.direction]}.
        </p>
      ) : (
        <p>
          Les informations disponibles orientent vers <b>{c.orientation.text}</b>. Cette interprétation repose sur <Refs ids={c.evidence_ids} onSelect={onSelect} />. La tendance sur{' '}
          {c.trend.period} est {trendWord[c.trend.direction]}.
          {c.alternative && (
            <>
              {' '}
              {c.alternative.text} reste possible car {c.alternative.missing_discriminant}.
            </>
          )}
        </p>
      )}
      <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
        Gabarit <span className="mono">{c.template_version}</span> · une hypothèse décrit une explication compatible, jamais la lecture certaine des intentions.
      </p>
    </section>
  );
}

export function Hypotheses({ list }: { list: Hypothesis[] }) {
  return (
    <section className="panel" aria-labelledby="hyp-title" data-testid="hypotheses">
      <h2 id="hyp-title">Hypothèses alternatives</h2>
      {list.length === 0 ? (
        <p className="empty">Aucune hypothèse évaluable.</p>
      ) : (
        <ul className="hyp-list">
          {list.map((h) => (
            <li key={h.id}>
              <details className="hyp">
                <summary>
                  <span className="hid">{h.id}</span>
                  <span>{h.label}</span>
                  <span className={`verdict ${h.verdict}`}>{VERDICT[h.verdict]}</span>
                </summary>
                <HypBlock title="En faveur" items={h.supports} />
                <HypBlock title="Contradictions" items={h.contradicts} />
                <HypBlock title="Discriminants manquants" items={h.missing} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HypBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucun.</p>
      )}
    </>
  );
}

const COV_WORD = { ok: 'À jour', degrade: 'Dégradée', indisponible: 'Indisponible' } as const;

export function CoveragePanel({ cov }: { cov: Coverage }) {
  return (
    <section className="panel" aria-labelledby="cov-title" data-testid="coverage">
      <h2 id="cov-title">Couverture et santé des données</h2>
      <p style={{ marginBottom: 8 }}>
        <span className={`chip ${cov.profile_satisfied ? 'ok' : 'watch'}`}>{cov.profile_satisfied ? 'Profil de couverture satisfait' : 'Profil de couverture non satisfait'}</span>{' '}
        <span className="muted">{cov.profile_label}</span>
      </p>
      <ul className="cov-list">
        {cov.families.map((f) => (
          <li key={f.id}>
            <span className={`dot ${f.state}`} aria-hidden="true" />
            <span>
              <span className="state-word">{COV_WORD[f.state]}</span> · {f.label}
              <br />
              <span className="muted">{f.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>
        {cov.baseline.detail}. {cov.pending_documents} document{cov.pending_documents > 1 ? 's' : ''} à qualifier ; {cov.pending_major_review} événement majeur en attente de revue.
        La couverture n’estime pas la fraction du monde réellement observable.
      </p>
    </section>
  );
}
