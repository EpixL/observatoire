import { useRef, useState } from 'react';
import type { AiState, DossierScenario, VeilleEvent } from '../types';
import { Hypotheses } from './Interpretation';
import { StatusBadge } from './EventViews';
import { fmt } from '../lib/format';
import { eventId } from '../lib/normalize';

const TABS = [
  { id: 'regles', label: 'Interprétation par règles' },
  { id: 'elements', label: 'Éléments' },
  { id: 'ia', label: 'Analyse IA' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const STATE: Record<DossierScenario['state'], string> = { actif: 'Actif', indetermine: 'Indéterminé', veille: 'En veille' };

interface Props {
  dossiers: DossierScenario[];
  events: VeilleEvent[];
  selectedDossier: string;
  onDossier: (id: string) => void;
  ai: AiState;
  onAi: () => void;
  onOpenSettings: () => void;
  aiDone: boolean;
  onSelectEvent: (id: string) => void;
}

export function Dossiers({ dossiers, events, selectedDossier, onDossier, ai, onAi, onOpenSettings, aiDone, onSelectEvent }: Props) {
  const [tab, setTab] = useState<TabId>('regles');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const d = dossiers.find((x) => x.id === selectedDossier) ?? dossiers[0];

  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[n].id);
    tabRefs.current[TABS[n].id]?.focus();
  };

  return (
    <div className="two-col" data-testid="dossiers">
      <section className="panel" aria-labelledby="dos-list">
        <h2 id="dos-list">Dossiers actifs</h2>
        <ul className="dossier-list">
          {dossiers.map((x) => (
            <li key={x.id}>
              <button type="button" className="dossier-btn" aria-current={x.id === d.id ? 'true' : undefined} onClick={() => onDossier(x.id)} data-testid={`dossier-${x.id}`}>
                <b>{x.title}</b>
                <span className="muted">
                  {x.zone} · {x.horizon}
                </span>
                <span>
                  <span className={`chip ${x.state === 'actif' ? 'data' : ''}`}>{STATE[x.state]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Les horizons sont des choix de produit, pas des délais prédictifs. Aucun dossier n’est additionné mécaniquement aux autres.
        </p>
      </section>

      <section className="panel" aria-labelledby="dos-title">
        <h2 id="dos-title" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 18, color: 'var(--text)' }}>
          {d.title}
        </h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          {d.zone} · horizon {d.horizon} · mis à jour {fmt(d.updated_at)} · règles <span className="mono">{d.rules_version}</span>
        </p>
        <div role="tablist" aria-label="Contenu du dossier" className="tabs">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="panel-regles" aria-labelledby="tab-regles" hidden={tab !== 'regles'} className="verdict-block">
          {tab === 'regles' && (
            <>
              <p style={{ fontSize: 16 }}>{d.rule_interpretation.conclusion}</p>
              <div className="cols3">
                <Col title="Ce qui soutient" items={d.rule_interpretation.supports} />
                <Col title="Ce qui contredit" items={d.rule_interpretation.contradicts} />
                <Col title="Ce qui manque pour départager" items={d.rule_interpretation.missing} />
              </div>
              {d.rule_interpretation.hypotheses.length > 0 && <Hypotheses list={d.rule_interpretation.hypotheses} />}
              <details className="fold">
                <summary>Méthode</summary>
                <p className="muted">
                  Observations typées → contrôle qualité → règles → confrontation d’hypothèses → phrases à gabarits avec preuves. Règles du dossier : <span className="mono">{d.rules_version}</span>. Aucune probabilité n’est produite ;
                  « plusieurs interprétations restent possibles » est une réponse admise. Cet onglet est toujours complet, avec ou sans IA.
                </p>
              </details>
            </>
          )}
        </div>

        <div role="tabpanel" id="panel-elements" aria-labelledby="tab-elements" hidden={tab !== 'elements'}>
          {tab === 'elements' && (
            <>
              {d.event_ids.length === 0 ? (
                <p className="empty">Aucun élément rattaché à ce dossier.</p>
              ) : (
                <ul className="ev-list">
                  {d.event_ids.map(eventId).map((id) => {
                    const e = events.find((x) => x.id === id);
                    if (!e) return null;
                    return (
                      <li key={id}>
                        <button type="button" className="ev-btn" onClick={() => onSelectEvent(id)}>
                          <span className="t">
                            <span className="mono muted">{e.id}</span> {e.title}
                          </span>
                          <span className="s">
                            <StatusBadge e={e} />
                            <span>
                              {e.independent_origins} origine{e.independent_origins > 1 ? 's' : ''} indépendante{e.independent_origins > 1 ? 's' : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                Un clic ouvre la fiche dans la carte.
              </p>
            </>
          )}
        </div>

        <div role="tabpanel" id="panel-ia" aria-labelledby="tab-ia" hidden={tab !== 'ia'} className="verdict-block">
          {tab === 'ia' && <AiPane ai={ai} onAi={onAi} onOpenSettings={onOpenSettings} done={aiDone} />}
        </div>
      </section>
    </div>
  );
}

function Col({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4>{title}</h4>
      {items.length ? <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="muted">Rien à signaler.</p>}
    </div>
  );
}

export function AiPane({ ai, onAi, onOpenSettings, done }: { ai: AiState; onAi: () => void; onOpenSettings: () => void; done: boolean }) {
  return (
    <>
      <p>
        L’analyse IA est <b>facultative</b> : elle ne modifie ni le score ni une confirmation officielle. Elle apparaît séparément, datée, avec modèle et références, et signale ses désaccords avec les règles. L’avis précédent n’est jamais effacé.
      </p>
      {!ai.available ? (
        <div className="notice" data-testid="ai-unavailable">
          L’analyse IA n’est <b>pas encore disponible côté serveur</b> (lot 5). Rien n’est envoyé nulle part ; l’interprétation par règles reste complète.
        </div>
      ) : ai.mode === 'desactivee' ? (
        <div className="notice">
          Le mode IA est <b>désactivé</b> : aucune consommation. <button type="button" className="btn link" onClick={onOpenSettings}>Activer manuellement dans les réglages</button> (aucun appel automatique).
        </div>
      ) : ai.budget_exhausted ? (
        <div className="notice">
          <b>Budget IA épuisé</b> ({ai.monthly_used_usd.toFixed(2)} / {ai.monthly_cap_usd.toFixed(2)} USD ce mois-ci). Toutes les autres fonctions restent accessibles ; l’interprétation par règles continue.
        </div>
      ) : (
        <p>
          <button type="button" className="btn primary" onClick={onAi} aria-haspopup="dialog" data-testid="ai-button">
            Approfondir avec l’IA
          </button>
        </p>
      )}
      {done && (
        <div className="notice" data-testid="ai-done">
          Maquette : aucune requête n’a été envoyée. En production, l’« Analyse complémentaire IA » apparaîtrait ici, datée, avec modèle et références, après vos preuves et sans changer la jauge.
        </div>
      )}
      <h4 className="subhead">Analyses précédentes</h4>
      {ai.previous_runs.length ? (
        <ul>
          {ai.previous_runs.map((r) => (
            <li key={r.at}>
              {fmt(r.at)} · {r.model} · {r.agreement_with_rules} — {r.summary}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucune analyse IA n’a été lancée.</p>
      )}
    </>
  );
}
