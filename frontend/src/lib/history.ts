import type { HistoryPoint, Palier } from '../types';

export interface Segment {
  from: string;
  to: string;
  palier: Palier | null;
}

/** Fusionne les points consécutifs de même valeur : sert à la fois au tracé en escalier et au tableau accessible. */
export function toSegments(points: HistoryPoint[]): Segment[] {
  const out: Segment[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.palier === p.palier) last.to = p.at;
    else out.push({ from: p.at, to: p.at, palier: p.palier });
  }
  return out;
}

/**
 * Chemin SVG en escalier : la valeur est maintenue jusqu'à la mesure suivante, SANS interpolation.
 * Un intervalle sans mesure (null) interrompt le tracé ; il n'est jamais remplacé par 0.
 */
export function stepPaths(points: HistoryPoint[], x: (iso: string) => number, y: (v: number) => number): string[] {
  const paths: string[] = [];
  let cur = '';
  let prevY = 0;
  for (const p of points) {
    if (p.palier === null) {
      if (cur) paths.push(cur);
      cur = '';
      continue;
    }
    const px = x(p.at);
    const py = y(p.palier);
    if (!cur) cur = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
    else if (py !== prevY) cur += ` H ${px.toFixed(1)} V ${py.toFixed(1)}`;
    else cur += ` H ${px.toFixed(1)}`;
    prevY = py;
  }
  if (cur) paths.push(cur);
  return paths;
}
