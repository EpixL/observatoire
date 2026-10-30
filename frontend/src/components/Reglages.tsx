import { useMemo, useState } from 'react';
import type { AiMode, NotificationLevel, NotificationSettings, SourceRecord, SourceVerdict, ThresholdsState } from '../types';
import { Dialog } from './Dialog';
import { fmt } from '../lib/format';
import { COMPARABILITY_SENTENCE, modifiedItems, validate } from '../lib/thresholds';
import { useMedia } from '../hooks/useMedia';

export type Theme = 'dark' | 'light';
export type Section = 'general' | 'sources' | 'notifications' | 'seuils';

export const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'sources', label: 'État des sources' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'seuils', label: 'Seuils de la jauge' },
];

interface Props {
  section: Section;
  now: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
  aiMode: AiMode;
  onAiMode: (m: AiMode) => void;
  budgetOut: boolean;
  onBudgetOut: (b: boolean) => void;
  sources: SourceRecord[];
  notifications: NotificationSettings;
  onNotifications: (n: NotificationSettings) => void;
  thresholds: ThresholdsState;
  /** Rejette avec le message du serveur (409, 422, 423, 401, 503…) : la boîte de confirmation reste ouverte et l'affiche. */
  onSaveThresholds: (changes: { key: string; to: number }[], reason: string) => Promise<void>;
  onResetThresholds: (reason: string) => Promise<void>;
}

export function Reglages(p: Props) {
  return (
    <div data-testid="reglages">
      <h1 className="sr-only">Réglages</h1>
      <nav className="subnav" aria-label="Sections des réglages">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/reglages/${s.id}`} aria-current={p.section === s.id ? 'page' : undefined} data-testid={`reglages-${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>
      {p.section === 'general' && <General {...p} />}
      {p.section === 'sources' && <SourcesStatus list={p.sources} now={p.now} />}
      {p.section === 'notifications' && <Notifications value={p.notifications} onChange={p.onNotifications} />}
      {p.section === 'seuils' && <Seuils {...p} />}
    </div>
  );
}

/* ---------- Général ---------- */

const MODES: { id: AiMode; label: string; hint: string }[] = [
  { id: 'desactivee', label: 'Désactivée', hint: 'Aucune extraction, inférence ni recherche IA. Consommation zéro.' },
  { id: 'a_la_demande', label: 'À la demande (recommandé)', hint: 'Une analyse n’est lancée qu’après confirmation du coût maximum.' },
  { id: 'automatique', label: 'Automatique sous conditions', hint: 'Seulement sur changement matériel, avec règles d’éligibilité et budget.' },
];

function General(p: Props) {
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="g-theme">
        <h2 id="g-theme">Apparence</h2>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="sr-only">Thème</legend>
          <label className="radio-row">
            <input type="radio" name="theme" checked={p.theme === 'dark'} onChange={() => p.onTheme('dark')} />
            <span>
              <b>Sombre — bleu nuit (par défaut)</b>
              <br />
              <span className="muted">Toujours appliqué au premier affichage, quel que soit le réglage de votre système.</span>
            </span>
          </label>
          <label className="radio-row">
            <input type="radio" name="theme" checked={p.theme === 'light'} onChange={() => p.onTheme('light')} />
            <span>
              <b>Clair — accessible</b>
              <br />
              <span className="muted">Choix mémorisé dans ce navigateur uniquement.</span>
            </span>
          </label>
        </fieldset>
      </section>
      <section className="panel" aria-labelledby="g-ai">
        <h2 id="g-ai">Mode IA</h2>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="sr-only">Mode IA</legend>
          {MODES.map((m) => (
            <label key={m.id} className="radio-row">
              <input type="radio" name="ai" checked={p.aiMode === m.id} onChange={() => p.onAiMode(m.id)} />
              <span>
                <b>{m.label}</b>
                <br />
                <span className="muted">{m.hint}</span>
              </span>
            </label>
          ))}
          <label className="radio-row">
            <input type="checkbox" checked={p.budgetOut} onChange={(e) => p.onBudgetOut(e.target.checked)} />
            <span>
              <b>Simuler un budget IA épuisé</b>
              <br />
              <span className="muted">Pour voir l’état « budget épuisé » : le reste du tableau de bord reste utilisable.</span>
            </span>
          </label>
        </fieldset>
        <p className="notice" style={{ marginTop: 10 }}>
          En maquette, ces choix ne sont conservés que dans cet onglet (le thème est mémorisé localement). Aucun appel IA n’est jamais effectué. Affichage en fuseau Europe/Paris ; données stockées en UTC.
        </p>
      </section>
    </div>
  );
}

/* ---------- État des sources (lecture seule) ---------- */

const VERDICT_GLOSS: Record<SourceVerdict, { sym: string; gloss: string }> = {
  OK: { sym: '✔', gloss: 'collecte réussie' },
  BLOCKED: { sym: '⛔', gloss: 'accès bloqué' },
  FAIL: { sym: '✖', gloss: 'échec' },
  SKIPPED: { sym: '⊘', gloss: 'non collectée' },
};

function VerdictBadge({ v }: { v: SourceVerdict }) {
  return (
    <span className={`verdict-badge ${v}`}>
      <span aria-hidden="true">{VERDICT_GLOSS[v].sym}</span> {v} <span className="sr-only">— {VERDICT_GLOSS[v].gloss}</span>
    </span>
  );
}

function SourcesStatus({ list, now }: { list: SourceRecord[]; now: string }) {
  const table = useMedia('(min-width: 768px)');
  const count = (v: SourceVerdict) => list.filter((s) => s.verdict === v).length;
  return (
    <section className="panel" aria-labelledby="ss-title" data-testid="sources-status">
      <h2 id="ss-title">État des sources · lecture seule</h2>
      <p className="muted" style={{ marginBottom: 10 }}>
        Au {fmt(now)}. Verdicts du dernier passage de chaque collecteur. L’activation ou la désactivation d’une source se fait dans la configuration du serveur, pas ici. Une page protégée par un contrôle anti-robot est
        signalée BLOCKED : elle n’est jamais contournée.
      </p>
      <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['OK', 'BLOCKED', 'FAIL', 'SKIPPED'] as SourceVerdict[]).map((v) => (
          <span key={v} className="chip">
            <VerdictBadge v={v} /> <span className="num">{count(v)}</span>
          </span>
        ))}
      </p>
      {table ? (
        <div className="tbl-wrap">
          <table className="data">
            <caption className="sr-only">Verdict du dernier passage de chaque source</caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Famille</th>
                <th scope="col">Dernier passage</th>
                <th scope="col">Verdict</th>
                <th scope="col">Motif</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <th scope="row" style={{ fontWeight: 600 }}>
                    {s.name}
                    <br />
                    <span className="muted" style={{ fontWeight: 400 }}>{s.organism}</span>
                  </th>
                  <td>{s.family}</td>
                  <td className="num">{s.last_attempt ? fmt(s.last_attempt) : 'jamais'}</td>
                  <td>
                    <VerdictBadge v={s.verdict} />
                  </td>
                  <td>{s.verdict_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="src-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map((s) => (
            <li key={s.id} className="src-row">
              <h3>{s.name}</h3>
              <p>
                <VerdictBadge v={s.verdict} />
              </p>
              <dl>
                <dt>Famille</dt>
                <dd>{s.family}</dd>
                <dt>Dernier passage</dt>
                <dd className="num">{s.last_attempt ? fmt(s.last_attempt) : 'jamais'}</dd>
                <dt>Motif</dt>
                <dd>{s.verdict_reason}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Notifications ---------- */

const LEVELS: { id: NotificationLevel; label: string; hint: string }[] = [
  { id: 'officiel', label: 'Décisions officielles seulement', hint: 'Voie rapide : nouvelle publication officielle pertinente.' },
  { id: 'officiel_a3', label: 'Décisions officielles + changements majeurs (A3)', hint: 'Votre choix. A3 peut venir d’une catastrophe civile, avec un indice de confrontation bas.' },
  { id: 'officiel_a2_a3', label: 'Décisions officielles + analyses approfondies (A2) et A3', hint: 'Plus de messages ; à n’activer que si la charge reste acceptable.' },
];

function Notifications({ value, onChange }: { value: NotificationSettings; onChange: (n: NotificationSettings) => void }) {
  const ro = !value.editable;
  return (
    <div className="stack" data-testid="notifications">
      <section className="panel" aria-labelledby="n-title">
        <h2 id="n-title">Notifications</h2>
        {!value.enabled && (
          <p className="banner method" style={{ marginBottom: 12 }} data-testid="silent-banner">
            <b>🔕 Mode silencieux{value.silent_until_pilot_end ? ' jusqu’à la fin du pilote' : ''}</b> (2 à 4 semaines, comme le plan le recommande). Le niveau choisi ci-dessous est conservé, <b>mais rien n’est envoyé</b> : collecte, jauge et historique continuent.
          </p>
        )}
        <p style={{ marginBottom: 10 }}>
          <span className="chip watch">Canal Telegram : non activé — interface seule (lot 7)</span>
        </p>
        {ro && (
          <p className="notice" style={{ marginBottom: 10 }} data-testid="notif-readonly">
            Réglage en lecture seule : le serveur ne gère pas encore les notifications (lot 7). L’état affiché est celui du pilote, pas un réglage enregistré.
          </p>
        )}
        <label className="switch-row">
          <input type="checkbox" checked={value.enabled} disabled={ro} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} data-testid="notif-enabled" />
          <span>
            <b>{value.enabled ? 'Notifications activées' : 'Sortir du mode silencieux (activer les notifications)'}</b>
            <br />
            <span className="muted">{value.enabled ? 'Décochez pour revenir au mode silencieux.' : 'Déconseillé avant la fin du pilote.'}</span>
          </span>
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Niveau {value.enabled ? '' : '(choisi, sans effet tant que silencieux)'}</legend>
          {LEVELS.map((l) => (
            <label key={l.id} className="radio-row">
              <input type="radio" name="level" checked={value.level === l.id} disabled={ro} onChange={() => onChange({ ...value, level: l.id })} />
              <span>
                <b>{l.label}</b>
                <br />
                <span className="muted">{l.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      <section className="panel" aria-labelledby="n-def">
        <h2 id="n-def">Niveaux d’attention</h2>
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          <li><b>A0</b> veille · <b>A1</b> vérification · <b>A2</b> analyse approfondie · <b>A3</b> changement majeur.</li>
          <li>Indépendants de la jauge : une inondation grave peut déclencher A3 avec un indice de confrontation à 10.</li>
          <li>Aucun statut officiel ni niveau de gravité n’est attribué par la seule IA.</li>
          <li>Une notification tardive conserve l’heure réelle de publication et affiche son retard.</li>
        </ul>
        <p className="notice" style={{ marginTop: 10 }}>
          Le plan recommande de démarrer en mode silencieux pendant 2 à 4 semaines avant d’activer les notifications. Ici, rien n’est envoyé : le choix est enregistré dans cet onglet seulement.
        </p>
      </section>
    </div>
  );
}

/* ---------- Seuils de la jauge ---------- */

function Seuils(p: Props) {
  const { items, history, policy_version } = p.thresholds;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);

  const errors = useMemo(() => Object.fromEntries(items.map((i) => [i.key, draft[i.key] !== undefined ? validate(i, draft[i.key]) : null])), [draft, items]);
  const pending = items
    .filter((i) => draft[i.key] !== undefined && Number(draft[i.key].replace(',', '.')) !== i.value && !errors[i.key])
    .map((i) => ({ item: i, to: Number(draft[i.key].replace(',', '.')) }));
  const hasError = Object.values(errors).some(Boolean);
  const modified = modifiedItems(items);
  const reasonOk = reason.trim().length >= 8;
  const close = () => {
    setErr(null);
    setConfirm(null);
    setReason('');
    setAck(false);
  };
  const num = (n: number) => String(n).replace('.', ',');
  // `pilot_frozen` absent (backend actuel) = gelé : valeur sûre ; seul `false` explicite débloque l'édition
  const frozen = p.thresholds.pilot_frozen !== false;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack" data-testid="seuils">
      <section className="panel" aria-labelledby="t-title">
        <h2 id="t-title">Seuils de la jauge</h2>
        <p style={{ marginBottom: 10 }}>
          {modified.length === 0 ? (
            <span className="chip ok" data-testid="thr-status">✔ Seuils conformes au plan</span>
          ) : (
            <span className="chip watch" data-testid="thr-status">⚠ {modified.length} seuil{modified.length > 1 ? 's' : ''} différent{modified.length > 1 ? 's' : ''} du plan</span>
          )}{' '}
          <span className="muted">
            Version de politique <span className="mono">{policy_version}</span>
          </span>
        </p>
        {frozen && (
          <div className="banner method" style={{ marginBottom: 12 }} data-testid="frozen-banner">
            <h2>🔒 Seuils gelés pendant le pilote</h2>
            <p>
              Les seuils sont en lecture seule : on évalue le système avec les valeurs du plan. Le déblocage passe par un indicateur de configuration du serveur (<span className="mono">pilot_frozen</span>), pas par un bouton de cette
              interface. Les garde-fous (motif, historique, indicateur sur la jauge) s’appliquent dès le déblocage.
            </p>
          </div>
        )}
        <p className="notice" data-testid="comparability">
          {COMPARABILITY_SENTENCE}
        </p>
        <p className="muted" style={{ marginTop: 10 }}>
          Les huit paliers (0, 10, 25, 40, 55, 70, 85, 100) et la définition de 0 et de 100 ne se modifient pas ici. Chaque enregistrement demande une confirmation et un motif, crée une nouvelle version datée et conservée, et
          l’indice affiche un avertissement tant que des seuils diffèrent du plan.
        </p>
      </section>

      <section className="panel" aria-labelledby="t-list">
        <h2 id="t-list">Seuils de décision</h2>
        <ul className="thr-list">
          {items.map((i) => {
            const raw = draft[i.key];
            const err = errors[i.key];
            const changedFromPlan = i.value !== i.plan_value;
            const id = `thr-${i.key}`;
            return (
              <li key={i.key} className={`thr${changedFromPlan ? ' changed' : ''}`}>
                <h3>
                  <label htmlFor={id}>{i.label}</label>
                </h3>
                <p className="desc">{i.description}</p>
                <div className="field">
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min={i.min}
                    max={i.max}
                    step={i.step}
                    value={raw ?? String(i.value)}
                    readOnly={frozen}
                    aria-readonly={frozen || undefined}
                    onChange={(e) => !frozen && setDraft({ ...draft, [i.key]: e.target.value })}
                    aria-invalid={err ? 'true' : undefined}
                    aria-describedby={`${id}-help`}
                    data-testid={id}
                  />
                  <span>{i.unit}</span>
                  <span id={`${id}-help`} className="muted">
                    Valeur du plan : <b className="num">{num(i.plan_value)}</b> · limites {num(i.min)} à {num(i.max)}
                  </span>
                  {changedFromPlan && <span className="chip watch">modifié (plan : {num(i.plan_value)})</span>}
                </div>
                {err && (
                  <p className="err" role="alert">
                    {err}
                  </p>
                )}
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Gouverne : {i.affects}
                </p>
              </li>
            );
          })}
        </ul>
        {frozen ? (
          <p className="muted" style={{ marginTop: 14 }} data-testid="frozen-note">
            Modification impossible tant que <span className="mono">pilot_frozen</span> est actif côté serveur ; le serveur refuserait d’ailleurs toute écriture (HTTP 423).
          </p>
        ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" className="btn primary" disabled={pending.length === 0 || hasError} onClick={() => setConfirm('save')} aria-haspopup="dialog" data-testid="thr-save">
            Enregistrer… ({pending.length})
          </button>
          <button type="button" className="btn" disabled={Object.keys(draft).length === 0} onClick={() => setDraft({})}>
            Annuler les saisies
          </button>
          <button type="button" className="btn" disabled={modified.length === 0} onClick={() => setConfirm('reset')} aria-haspopup="dialog" data-testid="thr-reset">
            Revenir aux valeurs du plan…
          </button>
        </div>
        )}
      </section>

      <section className="panel" aria-labelledby="t-hist" data-testid="thr-history">
        <h2 id="t-hist">Historique des changements de seuils</h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          Chaque changement est daté et conservé ; rien n’est jamais supprimé ni réécrit. Un retour aux valeurs du plan est lui aussi un changement daté.
        </p>
        {history.length === 0 ? (
          <p className="empty">Aucun changement : les seuils sont ceux du plan depuis l’installation.</p>
        ) : (
          <ol className="journal">
            {history.map((h) => (
              <li key={h.id}>
                <time dateTime={h.at} className="num">{fmt(h.at)}</time>
                <span>
                  <span className="chip">{h.kind === 'retour_plan' ? 'Retour au plan' : 'Modification'}</span> <span className="mono">{h.policy_version}</span> · <b>{h.label}</b> :{' '}
                  <span className="num">{num(h.from)} → {num(h.to)}</span>
                  <br />
                  <span className="muted">Motif : {h.reason} — {h.actor}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Dialog id="thr-confirm" open={confirm !== null} onClose={close} title={confirm === 'reset' ? 'Revenir aux valeurs du plan ?' : 'Enregistrer ces changements ?'}>
        <ul className="diff" aria-label="Changements">
          {(confirm === 'reset' ? modified.map((i) => ({ item: i, to: i.plan_value })) : pending).map(({ item, to }) => (
            <li key={item.key}>
              <b>{item.label}</b>
              <br />
              <span className="arrow num">{num(item.value)} → {num(to)}</span> <span className="muted">{item.unit} · plan : {num(item.plan_value)}</span>
            </li>
          ))}
        </ul>
        <p className="notice">{COMPARABILITY_SENTENCE} En production, le serveur recalcule et la tendance est signalée « non comparable » sur la période concernée.</p>
        <label>
          <span style={{ fontWeight: 600 }}>Motif (obligatoire, conservé avec le changement)</span>
          <textarea className="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pourquoi ce changement ? (8 caractères minimum)" data-testid="thr-reason" />
        </label>
        <label className="radio-row">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="thr-ack" />
          <span>Je comprends que l’historique sera moins comparable et que ce changement sera daté et conservé.</span>
        </label>
        {err && (
          <p className="err" role="alert" data-testid="thr-error">
            ✖ Enregistrement refusé : {err}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn primary"
            disabled={!reasonOk || !ack || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                if (confirm === 'reset') await p.onResetThresholds(reason.trim());
                else await p.onSaveThresholds(pending.map(({ item, to }) => ({ key: item.key, to })), reason.trim());
                setDraft({});
                close();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
            data-testid="thr-confirm"
          >
            {confirm === 'reset' ? 'Confirmer le retour au plan' : 'Confirmer et enregistrer'}
          </button>
          <button type="button" className="btn" onClick={close}>
            Annuler
          </button>
        </div>
      </Dialog>
    </div>
  );
}
