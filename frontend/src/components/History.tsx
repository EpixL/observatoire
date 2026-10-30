import type { HistoryPoint, MethodChange, ThresholdChange } from '../types';
import { PALIER_VALUES, palierLabel } from '../lib/scale';
import { stepPaths, toSegments } from '../lib/history';
import { fmt, fmtDay } from '../lib/format';

const W = 800;
const H = 300;
const L = 40;
const R = 12;
const T = 14;
const B = 30;

export function History({ points, changes, thresholdChanges = [] }: { points: HistoryPoint[]; changes: MethodChange[]; thresholdChanges?: ThresholdChange[] }) {
  const markers = [
    // changements de version relevés par le serveur dans l'historique de la jauge
    ...changes.map((c) => ({ at: c.at, label: `Seuils ${c.from_version.replace('seuils-', '')} → ${c.to_version.replace('seuils-', '')}` })),
    // changements enregistrés pendant cette session (maquette) et pas encore dans l'historique de la jauge
    ...[...new Map(thresholdChanges.map((c) => [c.policy_version, c])).values()]
      .filter((c) => !changes.some((m) => m.to_version === c.policy_version))
      .map((c) => ({ at: c.at, label: `Seuils ${c.policy_version.replace('seuils-', '')}` })),
  ];
  const t0 = Date.parse(points[0].at);
  const t1 = Date.parse(points[points.length - 1].at);
  const x = (iso: string) => L + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const paths = stepPaths(points, x, y);
  const segs = toSegments(points);
  const gaps = segs.filter((s) => s.palier === null);
  const days = [0, 5, 10, 15, 20, 25, 30].map((d) => new Date(t1 - d * 86_400_000).toISOString());
  const summary = segs
    .filter((s) => s.palier !== null)
    .map((s) => `palier ${s.palier} du ${fmtDay(s.from)} au ${fmtDay(s.to)}`)
    .join(' ; ');

  return (
    <section className="panel hist" aria-labelledby="hist-title" data-testid="history">
      <h2 id="hist-title">Historique des paliers · 30 jours · en escalier</h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Historique des paliers sur 30 jours, sans interpolation : ${summary}${gaps.length ? `. ${gaps.length} intervalle(s) sans mesure.` : '.'}`}>
        {PALIER_VALUES.map((v) => (
          <g key={v}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="axis num" x={L - 8} y={y(v)} textAnchor="end" dominantBaseline="central">
              {v}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <text key={i} className="axis" x={x(d)} y={H - 8} textAnchor={i === 0 ? 'end' : i === days.length - 1 ? 'start' : 'middle'}>
            {fmtDay(d)}
          </text>
        ))}
        {gaps.map((g, i) => {
          const gx = x(g.from);
          const w = Math.max(x(g.to) - gx, 6);
          return (
            <g key={i}>
              <rect className="gap" x={gx} y={T} width={w} height={H - T - B} />
              <text className="gap-lbl" x={gx + w / 2} y={T + 14} textAnchor={gx + w > W - 90 ? 'end' : 'middle'}>
                Pas de mesure
              </text>
            </g>
          );
        })}
        {markers.map((c, i) => {
          const mx = x(c.at);
          return (
            <g key={c.at + c.label}>
              <line className="mchg" x1={mx} x2={mx} y1={T} y2={H - B} />
              <text className="mchg-lbl" x={mx > W - 120 ? mx - 5 : mx + 5} y={T + 14 + (i % 2) * 28} textAnchor={mx > W - 120 ? 'end' : 'start'}>
                {c.label}
              </text>
            </g>
          );
        })}
        {paths.map((d, i) => (
          <path key={i} className="step" d={d} />
        ))}
      </svg>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Chaque valeur est un des huit paliers, maintenue jusqu’à la mesure suivante : aucune valeur intermédiaire n’est interpolée. Les intervalles sans mesure sont interrompus, pas remplacés par zéro.
      </p>
      <details className="fold">
        <summary>Voir les valeurs sous forme de tableau</summary>
        <table className="data">
          <caption className="sr-only">Paliers successifs</caption>
          <thead>
            <tr>
              <th scope="col">Du</th>
              <th scope="col">Au</th>
              <th scope="col">Palier</th>
            </tr>
          </thead>
          <tbody>
            {segs.map((s, i) => (
              <tr key={i}>
                <td className="num">{fmt(s.from)}</td>
                <td className="num">{fmt(s.to)}</td>
                <td>{s.palier === null ? 'Pas de mesure' : `${s.palier} — ${palierLabel(s.palier)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
