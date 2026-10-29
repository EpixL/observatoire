import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AiMode, NotificationSettings, Snapshot, ThresholdsState, VeilleEvent } from './types';
import { dataClient, isMock } from './api/client';
import { ago } from './lib/format';
import { DEFAULT_FILTERS, applyFilters, type Filters } from './lib/filters';
import { isInView, type MapViewId } from './lib/geo';
import { CivilBanner, DemoBar, MethodBanner, Nuclear } from './components/Banners';
import { Gauge } from './components/Gauge';
import { ScaleDialog } from './components/ScaleDialog';
import { Conclusion, CoveragePanel, Hypotheses } from './components/Interpretation';
import { MapPanel } from './components/MapPanel';
import { EventCard, EventList } from './components/EventViews';
import { History } from './components/History';
import { Dossiers } from './components/Dossiers';
import { AiDialog } from './components/AiDialog';
import { Journal, Sources } from './components/Registry';
import { Reglages, SECTIONS, type Section, type Theme } from './components/Reglages';
import { adjustGauge, modifiedItems } from './lib/thresholds';
import { useMedia } from './hooks/useMedia';

const ROUTES = [
  { id: 'vue', label: 'Vue d’ensemble', short: 'Vue' },
  { id: 'dossiers', label: 'Dossiers', short: 'Dossiers' },
  { id: 'carte', label: 'Carte', short: 'Carte' },
  { id: 'sources', label: 'Sources', short: 'Sources' },
  { id: 'journal', label: 'Journal', short: 'Journal' },
] as const;
type RouteId = (typeof ROUTES)[number]['id'] | 'reglages';

function readRoute(): { route: RouteId; section: Section } {
  const [h, sub] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = (SECTIONS.find((x) => x.id === sub)?.id ?? 'general') as Section;
  if (h === 'reglages') return { route: 'reglages', section };
  return { route: (ROUTES.find((r) => r.id === h)?.id ?? 'vue') as RouteId, section };
}
function readScenario(): string {
  return new URLSearchParams(window.location.search).get('scenario') ?? 'nominal';
}
/** Bleu nuit TOUJOURS par défaut, quel que soit le réglage du système ; seul un choix manuel « clair » est mémorisé. */
function readTheme(): Theme {
  try {
    if (window.localStorage.getItem('veille-theme') === 'light') return 'light';
  } catch {
    /* stockage indisponible : thème sombre */
  }
  return 'dark';
}

export default function App() {
  const [scenario, setScenario] = useState(readScenario);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loc, setLoc] = useState(readRoute);
  const { route, section } = loc;
  const [thr, setThr] = useState<ThresholdsState | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [view, setView] = useState<MapViewId>('europe');
  const [overseas, setOverseas] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clusterIds, setClusterIds] = useState<string[]>([]);
  const [dossierId, setDossierId] = useState('D-REG');
  const [scaleOpen, setScaleOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [budgetOut, setBudgetOut] = useState<boolean | null>(null);
  const [streamOn, setStreamOn] = useState(false);
  const wide = useMedia('(min-width: 1100px)');

  useEffect(() => {
    const on = () => setLoc(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    let live = true;
    dataClient.load(scenario).then((s) => {
      if (!live) return;
      setSnap(s);
      setThr(s.thresholds);
      setNotif(s.notifications);
    });
    const off = dataClient.subscribe(
      (m) => {
        if (m.type === 'snapshot') setSnap(m.data);
      },
      setStreamOn,
    );
    return () => {
      live = false;
      off();
    };
  }, [scenario]);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('veille-theme', theme);
    } catch {
      /* ignoré */
    }
  }, [theme]);

  const changeScenario = useCallback((id: string) => {
    setScenario(id);
    setSelectedId(null);
    setClusterIds([]);
    const u = new URL(window.location.href);
    u.searchParams.set('scenario', id);
    window.history.replaceState(null, '', u);
  }, []);

  const select = useCallback((id: string) => setSelectedId(id), []);
  const go = (r: string) => {
    window.location.hash = `/${r}`;
  };

  const eventsById = useMemo(() => Object.fromEntries((snap?.events ?? []).map((e) => [e.id, e])), [snap]);
  const visible = useMemo(() => (snap ? applyFilters(snap.events, filters, snap.as_of) : []), [snap, filters]);
  const selected: VeilleEvent | null = selectedId ? (eventsById[selectedId] ?? null) : null;

  if (!snap || !thr || !notif) return <p style={{ padding: 16 }}>Chargement de la maquette…</p>;

  const ai = { ...snap.ai, mode: aiMode ?? snap.ai.mode, budget_exhausted: budgetOut ?? snap.ai.budget_exhausted };
  const saveThresholds = (changes: { key: string; to: number }[], reason: string) => void dataClient.saveThresholds(thr, changes, reason).then(setThr);
  const resetThresholds = (reason: string) => void dataClient.resetThresholds(thr, reason).then(setThr);
  const saveNotifications = (n: NotificationSettings) => {
    setNotif(n);
    void dataClient.saveNotifications(n);
  };
  const gauge = adjustGauge(snap.gauge, thr.history, snap.as_of);
  const nModified = modifiedItems(thr.items).length;
  const okSources = snap.sources.filter((s) => s.state === 'ok').length;
  const offView = !!selected && !isInView(selected, view, overseas);
  const nonCalc = gauge.status === 'non_calculable';
  const modeLabel = { desactivee: 'IA désactivée', a_la_demande: 'IA à la demande', automatique: 'IA automatique' }[ai.mode];

  const openDossier = (id: string) => {
    setDossierId(id);
    go('dossiers');
  };
  const goEurope = () => {
    setView('europe');
  };
  const onView = (v: MapViewId) => {
    setView(v);
    setClusterIds([]);
  };

  const map = (
    <MapPanel
      view={view}
      onView={onView}
      overseas={overseas}
      onOverseas={setOverseas}
      filters={filters}
      onFilters={setFilters}
      events={visible}
      totalEvents={snap.events.length}
      selectedId={selectedId}
      onSelect={(id) => {
        setClusterIds([]);
        select(id);
      }}
      onCluster={setClusterIds}
      clusterIds={clusterIds}
      eventsById={eventsById}
    />
  );
  const card = <EventCard event={selected} view={view} offView={offView} onGoEurope={goEurope} onOpenDossier={openDossier} />;
  const list = <EventList events={visible} counters={snap.counters} selectedId={selectedId} onSelect={select} />;
  const aiButton = (
    <p className="panel" style={{ margin: 0 }}>
      <button type="button" className="btn" style={{ width: '100%' }} onClick={() => (ai.mode === 'desactivee' || ai.budget_exhausted ? go('dossiers') : setAiOpen(true))} aria-haspopup={ai.mode === 'desactivee' || ai.budget_exhausted ? undefined : 'dialog'}>
        Approfondir avec l’IA (facultatif)
      </button>
    </p>
  );

  return (
    <>
      <a className="skip" href="#main">
        Aller au contenu
      </a>
      <DemoBar scenario={scenario} onScenario={changeScenario} />
      <div className="shell">
        <header className="header">
          <div className="brand">
            <b>VEILLE</b>
            <span>observatoire de situation</span>
          </div>
          <div className="zone">
            <small>Territoire évalué</small>
            <strong>{gauge.territory.label}</strong>
          </div>
          <div className="status" aria-label="État du système">
            <span className={`chip ${okSources === snap.sources.length ? 'ok' : 'watch'}`} data-testid="src-state">
              Sources : {okSources}/{snap.sources.length} à jour
            </span>
            <span className="chip" data-testid="last-collect">
              Dernière collecte {ago(snap.last_collect, snap.as_of)}
            </span>
            <span className="chip" data-testid="ai-mode">
              {modeLabel}
              {ai.budget_exhausted && ai.mode !== 'desactivee' ? ' · budget épuisé' : ''}
            </span>
            <span className="chip" title="Flux temps réel">
              {isMock ? 'Maquette hors ligne' : streamOn ? 'Flux connecté' : 'Flux interrompu'}
            </span>
          </div>
          <div className="actions">
            <a className="btn" href="#/reglages/general" aria-current={route === 'reglages' ? 'page' : undefined} data-testid="settings-btn">
              Réglages
            </a>
          </div>
        </header>

        <nav className="nav" aria-label="Navigation principale">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined} data-testid={`nav-${r.id}`}>
              <span className="long-label">{wide ? r.label : r.short}</span>
            </a>
          ))}
        </nav>

        <main id="main" tabIndex={-1} className="stack">
          {snap.civil_alert && <CivilBanner alert={snap.civil_alert} />}
          {snap.method_changes.map((c) => (
            <MethodBanner key={c.at} change={c} />
          ))}

          {route === 'vue' && (
            <>
              <div className="overview">
                <div className="col-left">
                  <div className="o-gauge panel">
                    <Gauge gauge={gauge} compact={!wide} onExplain={() => setScaleOpen(true)} thresholdsModified={nModified} />
                  </div>
                  {snap.nuclear && (
                    <div className="o-nuc">
                      <Nuclear badge={snap.nuclear} />
                    </div>
                  )}
                  <div className="o-concl">
                    <Conclusion c={snap.conclusion} onSelect={select} />
                  </div>
                  <div className="o-hyp stack">
                    <Hypotheses list={snap.hypotheses} />
                    {aiButton}
                  </div>
                  <div className="o-cov">
                    <CoveragePanel cov={snap.coverage} />
                  </div>
                </div>
                <div className="col-main">
                  <div className="o-map">{map}</div>
                  <div className="below-map">
                    <div className="o-card">{card}</div>
                    <div className="o-list">{list}</div>
                  </div>
                </div>
              </div>
              <div className="below">
                <History points={snap.history} changes={snap.method_changes} thresholdChanges={thr.history} />
                <section className="panel" aria-labelledby="dos-sum">
                  <h2 id="dos-sum">Dossiers actifs</h2>
                  <ul className="dossier-list">
                    {snap.dossiers.map((d) => (
                      <li key={d.id}>
                        <button type="button" className="dossier-btn" onClick={() => openDossier(d.id)}>
                          <b>{d.title}</b>
                          <span className="muted">
                            {d.zone} · {d.horizon} · {d.state === 'indetermine' ? 'Indéterminé' : 'Actif'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          )}

          {route === 'carte' && (
            <div className="col-main">
              <div className="o-map">{map}</div>
              <div className="below-map">
                <div className="o-card">{card}</div>
                <div className="o-list">{list}</div>
              </div>
            </div>
          )}

          {route === 'dossiers' && (
            <Dossiers
              dossiers={snap.dossiers}
              events={snap.events}
              selectedDossier={dossierId}
              onDossier={setDossierId}
              ai={ai}
              onAi={() => setAiOpen(true)}
              onOpenSettings={() => go('reglages/general')}
              aiDone={aiDone}
              onSelectEvent={(id) => {
                select(id);
                go('carte');
              }}
            />
          )}
          {route === 'sources' && <Sources list={snap.sources} now={snap.as_of} />}
          {route === 'journal' && <Journal entries={snap.journal} />}
          {route === 'reglages' && (
            <Reglages
              section={section}
              now={snap.as_of}
              theme={theme}
              onTheme={setTheme}
              aiMode={ai.mode}
              onAiMode={setAiMode}
              budgetOut={ai.budget_exhausted}
              onBudgetOut={setBudgetOut}
              sources={snap.sources}
              notifications={notif}
              onNotifications={saveNotifications}
              thresholds={thr}
              onSaveThresholds={saveThresholds}
              onResetThresholds={resetThresholds}
            />
          )}
        </main>

        <footer className="footer">
          VEILLE · maquette v0.1 · indice conventionnel, jamais une probabilité · aucun compte à rebours · {nonCalc ? 'indice courant non calculable' : `échelle ${gauge.policy.version} · ${thr.policy_version}`}
        </footer>
      </div>

      <ScaleDialog open={scaleOpen} onClose={() => setScaleOpen(false)} gauge={gauge} thresholdsModified={nModified} />
      <AiDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        ai={ai}
        onConfirm={() => {
          setAiDone(true);
          setAiOpen(false);
          go('dossiers');
        }}
      />
    </>
  );
}
