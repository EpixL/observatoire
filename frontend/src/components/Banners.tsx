import type { CivilAlert, MethodChange, NuclearBadge, NuclearKind } from '../types';
import { fmt } from '../lib/format';
import { SCENARIOS } from '../mocks/scenarios';

export function DemoBar({ scenario, onScenario }: { scenario: string; onScenario: (id: string) => void }) {
  return (
    <div className="demo-bar" role="region" aria-label="Mode maquette">
      <strong>Données fictives — maquette</strong>
      <span className="muted">Aucune notification réelle, aucun appel IA, aucune requête externe.</span>
      <label>
        <span>Scénario de démonstration</span>
        <select value={scenario} onChange={(e) => onScenario(e.target.value)} data-testid="scenario-select">
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function CivilBanner({ alert }: { alert: CivilAlert }) {
  return (
    <section className="banner civil" aria-labelledby="civil-title" data-testid="civil-banner">
      <h2 id="civil-title">{alert.title}</h2>
      <p>{alert.detail}</p>
      <div className="row">
        <span className="muted">
          {alert.issuer} · depuis <time dateTime={alert.since}>{fmt(alert.since)}</time>
        </span>
        <a href={alert.instruction_url} onClick={(e) => e.preventDefault()} aria-describedby="civil-demo">
          Consigne officielle
        </a>
        <span id="civil-demo" className="muted">
          (lien factice en maquette)
        </span>
      </div>
    </section>
  );
}

export function MethodBanner({ change }: { change: MethodChange }) {
  return (
    <section className="banner method" aria-labelledby="method-title" data-testid="method-banner">
      <h2 id="method-title">Changement de méthode — {change.from_version} → {change.to_version}</h2>
      <p>{change.note}</p>
      <p>
        {change.handling === 'tendance_suspendue'
          ? 'La tendance est suspendue : une nouvelle pondération ne doit pas passer pour une dégradation réelle.'
          : 'L’historique a été recalculé explicitement sous la même règle.'}{' '}
        Changement appliqué le <time dateTime={change.at}>{fmt(change.at)}</time>.
      </p>
    </section>
  );
}

const NUC_STATES: { kind: NuclearKind; label: string }[] = [
  { kind: 'discours', label: 'Discours / menace' },
  { kind: 'exercice', label: 'Exercice' },
  { kind: 'alerte_radiologique', label: 'Alerte radiologique' },
  { kind: 'emploi_confirme', label: 'Emploi confirmé' },
];

export function Nuclear({ badge }: { badge: NuclearBadge }) {
  return (
    <section className="nuclear" aria-labelledby="nuc-title" data-testid="nuclear-badge">
      <h2 id="nuc-title">
        <span className="chip watch">Nucléaire / radiologique</span> {NUC_STATES.find((s) => s.kind === badge.kind)!.label}
      </h2>
      <ol aria-label="Les quatre états distingués">
        {NUC_STATES.map((s) => (
          <li key={s.kind} aria-current={s.kind === badge.kind ? 'true' : undefined}>
            {s.label}
            {s.kind === badge.kind ? ' · état actuel' : ''}
          </li>
        ))}
      </ol>
      <p>
        <b>Portée :</b> {badge.scope}
      </p>
      <p>
        <b>Statut :</b> {badge.status}
      </p>
      <p>
        <b>Source :</b> {badge.source}
      </p>
      <p>
        <b>Consigne :</b> {badge.instructions}
      </p>
      <p>Indépendant du palier de la jauge. L’absence de badge ne signifie pas absence certaine de risque.</p>
    </section>
  );
}
