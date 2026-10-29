// Fabrique src/geo/geo.json à partir de Natural Earth (domaine public).
// Exécuté à la main par un développeur (réseau nécessaire) ; le résultat est commité,
// l'application n'a donc besoin d'aucun réseau ni d'aucune tuile à l'exécution.
//   node scripts/build-geo.mjs [dossier-des-geojson]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const dir = process.argv[2];

async function load(name) {
  if (dir && existsSync(join(dir, `${name}.geojson`))) {
    return JSON.parse(await readFile(join(dir, `${name}.geojson`), 'utf8'));
  }
  const r = await fetch(`${BASE}/${name}.geojson`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

// Douglas-Peucker (tolérance en degrés)
function dp(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (len === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const r2 = (n) => Math.round(n * 100) / 100;
function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
}
function simplifyGeom(g, tol, minArea) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out = [];
  for (const poly of polys) {
    if (ringArea(poly[0]) < minArea) continue;
    const rings = poly.map((ring) => dp(ring, tol).map(([x, y]) => [r2(x), r2(y)])).filter((r) => r.length >= 4);
    if (rings.length) out.push(rings);
  }
  if (!out.length) return null;
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}
function slim(fc, props, tol, minArea, keep = () => true) {
  const features = [];
  for (const f of fc.features) {
    if (!keep(f)) continue;
    const geometry = simplifyGeom(f.geometry, tol, minArea);
    if (!geometry) continue;
    features.push({ type: 'Feature', properties: props(f.properties), geometry });
  }
  return { type: 'FeatureCollection', features };
}
function bboxCenter(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

const world110 = await load('ne_110m_admin_0_countries');
const world50 = await load('ne_50m_admin_0_countries');
const units50 = await load('ne_50m_admin_0_map_units');

const cp = (p) => ({ n: p.NAME_FR || p.NAME, i: p.ADM0_A3 });
const world = slim(world110, cp, 0.05, 0.01);
const europe = slim(world50, cp, 0.04, 0.05, (f) => {
  if (['USA', 'KWT', 'ATA'].includes(f.properties.ADM0_A3)) return false;
  const [cx, cy] = bboxCenter(f.geometry);
  return cx > -32 && cx < 50 && cy > 27 && cy < 73;
});
// La France des pays inclut la Guyane etc. (centre hors Europe) : on prend la métropole seule.
europe.features.push(
  ...slim(units50, (p) => ({ n: 'France', i: 'FRA' }), 0.04, 0.05, (f) => f.properties.GU_A3 === 'FXX').features
);
// France : une entité par territoire (France métropolitaine, Guadeloupe, Réunion, …)
const franceUnits = slim(
  units50,
  (p) => ({ n: p.NAME_FR || p.NAME, i: p.GU_A3 || p.ADM0_A3 }),
  0.008, 0.0005,
  (f) => ['FRA', 'SPM', 'WLF', 'MAF', 'BLM', 'PYF', 'NCL'].includes(f.properties.ADM0_A3) && f.properties.GU_A3 !== 'ATF'
);

const out = { source: 'Natural Earth (domaine public) — naturalearthdata.com', world, europe, franceUnits };
await mkdir(join(here, '../src/geo'), { recursive: true });
const json = JSON.stringify(out);
await writeFile(join(here, '../src/geo/geo.json'), json);
console.log(`geo.json: ${(json.length / 1024).toFixed(0)} Ko — world ${world.features.length}, europe ${europe.features.length}, france ${franceUnits.features.length}`);
