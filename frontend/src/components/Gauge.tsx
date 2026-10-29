import type { GaugeState } from '../types';
import { GAUGE_SWEEP, GRADUATIONS, PALIER_VALUES, palierAngle, palierDef, palierTone, trendSentence } from '../lib/scale';
import { fmt, fmtFull } from '../lib/format';

const CX = 120;
const CY = 118;
const R = 86;

function pt(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}
function arc(from: number, to: number, r = R): string {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface Props {
  gauge: GaugeState;
  compact?: boolean;
  onExplain: () => void;
  /** Nombre de seuils différents de ceux du plan (garde-fou : toujours signalé sur la jauge). */
  thresholdsModified?: number;
}

/**
 * Jauge circulaire partielle (270°) graduée 0–25–55–85–100.
 * Seuls les huit paliers sont affichables : pas de 43,7. Pas d'aiguille animée, pas de minuit, pas de compte à rebours.
 */
export function Gauge({ gauge, compact, onExplain, thresholdsModified = 0 }: Props) {
  const unavailable = gauge.status === 'non_calculable' || gauge.palier === null;
  const palier = gauge.palier;
  const tone = unavailable ? 'neutral' : palierTone(palier);
  const start = -GAUGE_SWEEP / 2;
  const label = unavailable ? 'Indice courant non calculable' : palierDef(palier!).label;
  const aria = unavailable
    ? `Indice de situation non calculable pour ${gauge.territory.label}. Couverture insuffisante.`
    : `Indice de situation : ${palier} sur 100, ${label}, ${gauge.territory.label}. Ce n’est pas une probabilité.`;
  const val = unavailable ? null : palierAngle(palier!);
  const [dx, dy] = val === null ? [0, 0] : pt(val, R);

  return (
    <section className={`gauge${compact ? ' compact' : ''}`} aria-labelledby="gauge-title">
      <h2 id="gauge-title" className="sr-only">
        Indice de situation
      </h2>
      <svg viewBox="0 0 240 200" role="img" aria-label={aria}>
        <path className="g-track" d={arc(start, -start)} fill="none" strokeWidth="14" strokeDasharray={unavailable ? '2 6' : undefined} />
        {!unavailable && palier! > 0 && <path className={`g-val tone-${tone}`} d={arc(start, val!)} fill="none" strokeWidth="14" />}
        {PALIER_VALUES.map((v) => {
          const a = palierAngle(v);
          const major = (GRADUATIONS as readonly number[]).includes(v);
          const [x1, y1] = pt(a, R + 11);
          const [x2, y2] = pt(a, R + (major ? 18 : 15));
          return <line key={v} className="g-tick" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={major ? 2 : 1.2} />;
        })}
        {GRADUATIONS.map((v) => {
          const [x, y] = pt(palierAngle(v), R + 31);
          return (
            <text key={v} className="g-grad num" x={x} y={y} textAnchor="middle" dominantBaseline="central" aria-hidden="true">
              {v}
            </text>
          );
        })}
        {!unavailable && (
          <circle className={`g-dot tone-${tone}`} cx={dx} cy={dy} r="9" />
        )}
        <text className="g-num num" x={CX} y={CY + 10} textAnchor="middle" aria-hidden="true">
          {unavailable ? '—' : palier}
        </text>
        <text className="g-lbl" x={CX} y={CY + 34} textAnchor="middle" aria-hidden="true">
          {label.length > 18 ? splitLabel(label)[0] : label}
        </text>
        {label.length > 18 && (
          <text className="g-lbl" x={CX} y={CY + 50} textAnchor="middle" aria-hidden="true">
            {splitLabel(label)[1]}
          </text>
        )}
        <text className="g-grad" x={CX} y={CY + 70} textAnchor="middle" aria-hidden="true">
          sur 100
        </text>
      </svg>

      <div className="meta">
        <p className="kicker">Indice de situation · pas une probabilité</p>
        <p className="muted">{gauge.territory.label}</p>
        <p className="muted">
          Dernière mise à jour <time dateTime={gauge.as_of} title={fmtFull(gauge.as_of)}>{fmt(gauge.as_of)}</time>
        </p>
      </div>

      {unavailable && gauge.last_known && (
        <p className="last-known">
          Dernière valeur connue : <b className="num">{gauge.last_known.palier}</b> ({palierDef(gauge.last_known.palier).label}) le{' '}
          <time dateTime={gauge.last_known.at}>{fmt(gauge.last_known.at)}</time>. Elle ne vaut pas valeur courante.
        </p>
      )}
      {gauge.partial_coverage && (
        <p style={{ marginTop: 8 }}>
          <span className="chip watch">Couverture partielle · palier documenté</span>
        </p>
      )}
      {thresholdsModified > 0 && (
        <p style={{ marginTop: 8 }} data-testid="thresholds-flag">
          <a className="chip watch" href="#/reglages/seuils" style={{ minHeight: 44, textDecoration: 'none' }}>
            ⚠ Seuils modifiés ({thresholdsModified}) — différents de ceux du plan
          </a>
        </p>
      )}
      {!unavailable && (
        <>
          <p className="trend-line">{trendSentence(gauge.trend_24h, '24 h')}</p>
          <p className="trend-line">{trendSentence(gauge.trend_7d, '7 jours')}</p>
        </>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onExplain} aria-haspopup="dialog">
          Comprendre l’échelle
        </button>
      </div>
    </section>
  );
}

function splitLabel(s: string): [string, string] {
  const words = s.split(' ');
  let a = '';
  let i = 0;
  while (i < words.length && (a + ' ' + words[i]).trim().length <= 18) a = (a + ' ' + words[i++]).trim();
  return [a, words.slice(i).join(' ')];
}
