import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { open } from './helpers';

const axeSource = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const ROUTES = ['vue', 'dossiers', 'carte', 'sources', 'journal', 'reglages/general', 'reglages/sources', 'reglages/notifications', 'reglages/seuils'];

for (const theme of ['dark', 'light'] as const) {
  test(`axe-core (WCAG 2 A/AA) — thème ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const run = async (label: string) => {
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(() =>
        // @ts-expect-error axe est injecté
        window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }),
      );
      const v = res.violations.map((x: { id: string; nodes: { target: unknown[] }[] }) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
      expect(v, label).toEqual([]);
    };
    for (const s of ['nominal', 'indisponible', 'civile', 'nucleaire', 'seuils']) {
      for (const r of ROUTES) {
        await open(page, s, r, theme);
        await run(`${s}/${r}`);
      }
    }
    await open(page, 'nominal', 'vue', theme);
    await page.getByTestId('ev-EV-5').click();
    await page.getByRole('button', { name: 'Comprendre l’échelle' }).click();
    await run('dialogue échelle');
    await page.keyboard.press('Escape');
    await open(page, 'seuils', 'reglages/seuils', theme, '&pilot_frozen=0');
    await page.getByTestId('thr-reset').click();
    await run('dialogue seuils');
  });
}
