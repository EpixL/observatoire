import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {');
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Paires texte / fond réellement utilisées par l'interface. Seuil WCAG AA : 4,5:1 (texte). */
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'panel'], ['text', 'panel-2'],
  ['muted', 'bg'], ['muted', 'panel'], ['muted', 'panel-2'], ['muted', 'map-sea'],
  ['data', 'bg'], ['data', 'panel'], ['data', 'panel-2'],
  ['watch', 'bg'], ['watch', 'panel'], ['watch', 'panel-2'],
  ['grave', 'panel'], ['grave', 'panel-2'],
  ['ok', 'panel'], ['ok', 'panel-2'],
  ['on-accent', 'accent-bg'], ['on-accent', 'watch-bg'], ['on-accent', 'grave-bg'],
];
// Éléments graphiques porteurs d’information (arc de jauge, marqueurs, focus) : seuil 3:1. Les frontières de pays sont décoratives.
const GRAPHIC_PAIRS: [string, string][] = [['data', 'panel'], ['watch', 'panel'], ['grave', 'panel'], ['focus', 'panel'], ['focus', 'bg']];

describe.each([
  ['sombre', ':root'],
  ['clair', ":root[data-theme='light']"],
])('contrastes — thème %s', (_n, sel) => {
  const t = block(sel);
  it.each(TEXT_PAIRS)('texte %s sur %s ≥ 4,5:1', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(GRAPHIC_PAIRS)('graphique %s sur %s ≥ 3:1', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
