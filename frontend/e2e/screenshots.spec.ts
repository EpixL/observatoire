import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { open } from './helpers';

// Régénère docs/screenshots/ : `npm run screenshots`
const OUT = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));
// La barre de navigation mobile est fixe : on la rend statique pour que la capture pleine page ne la répète pas au milieu.
const FLAT = '.nav{position:static!important} .demo-bar{position:static!important}';

for (const w of [320, 390, 768, 1440]) {
  test(`captures nominal ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: w >= 1100 ? 900 : 844 });
    await open(page, 'nominal', '', 'dark');
    await page.addStyleTag({ content: FLAT });
    await page.getByTestId('ev-EV-001').click();
    await page.screenshot({ path: `${OUT}nominal-sombre-${w}.png`, fullPage: true });
    if (w === 1440 || w === 390) {
      await open(page, 'nominal', '', 'light');
      await page.addStyleTag({ content: FLAT });
      await page.getByTestId('ev-EV-001').click();
      await page.screenshot({ path: `${OUT}nominal-clair-${w}.png`, fullPage: true });
    }
  });
}

const STATES: [string, string][] = [
  ['seuils', 'seuils-modifies'],
  ['indisponible', 'donnees-indisponibles'],
  ['ambigu', 'situation-ambigue'],
  ['civile', 'alerte-civile'],
  ['nucleaire', 'nucleaire-radiologique'],
  ['methode', 'changement-de-methode'],
  ['partielle', 'fait-grave-couverture-partielle'],
];
for (const [id, name] of STATES) {
  for (const w of [390, 1440]) {
    test(`état ${id} ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w >= 1100 ? 900 : 844 });
      await open(page, id, '', 'dark');
      await page.addStyleTag({ content: FLAT });
      await page.screenshot({ path: `${OUT}etat-${name}-${w}.png`, fullPage: w < 1100 ? false : false });
    });
  }
}

// Écrans Réglages : au moins mobile + ordinateur pour chacun.
const SETTINGS: [string, string, string][] = [
  ['general', 'nominal', 'reglages-general'],
  ['sources', 'indisponible', 'reglages-etat-des-sources'],
  ['notifications', 'nominal', 'reglages-notifications'],
  ['seuils', 'seuils', 'reglages-seuils'],
];
for (const w of [390, 1440]) {
  for (const [section, scenario, name] of SETTINGS) {
    test(`réglages ${section} ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w >= 1100 ? 900 : 844 });
      await open(page, scenario, `reglages/${section}`, 'dark');
      await page.addStyleTag({ content: FLAT });
      await page.screenshot({ path: `${OUT}${name}-${w}.png`, fullPage: true });
    });
  }
  test(`réglages seuils : confirmation ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: w >= 1100 ? 900 : 844 });
    await open(page, 'nominal', 'reglages/seuils', 'dark');
    await page.getByTestId('thr-anomaly_mad_k').fill('9');
    await page.screenshot({ path: `${OUT}reglages-seuils-garde-fou-limite-${w}.png` });
    await page.getByTestId('thr-anomaly_mad_k').fill('2.5');
    await page.getByTestId('thr-save').click();
    await page.getByTestId('thr-reason').fill('Essai de détection plus précoce des chutes de connectivité');
    await page.getByTestId('thr-ack').check();
    await page.screenshot({ path: `${OUT}reglages-seuils-confirmation-${w}.png` });
  });
}

test('captures carte, outre-mer, dialogues, autres pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'nominal', 'carte', 'dark');
  await page.getByTestId('view-europe').click();
  await page.getByTestId('marker-EV-002').click();
  await page.screenshot({ path: `${OUT}carte-europe-1440.png` });
  await page.getByTestId('view-monde').click();
  await page.screenshot({ path: `${OUT}carte-monde-1440.png` });
  await page.getByTestId('view-france').click();
  await page.getByTestId('view-outremer').click();
  await page.screenshot({ path: `${OUT}carte-outre-mer-1440.png` });
  await open(page, 'nominal', '', 'dark');
  await page.getByRole('button', { name: 'Comprendre l’échelle' }).click();
  await page.screenshot({ path: `${OUT}dialogue-echelle-1440.png` });
  await page.keyboard.press('Escape');
  await open(page, 'nominal', 'dossiers', 'dark');
  await page.getByTestId('tab-ia').click();
  await page.getByTestId('ai-button').click();
  await page.screenshot({ path: `${OUT}dialogue-ia-1440.png` });
  await page.keyboard.press('Escape');
  await page.getByTestId('tab-regles').click();
  await page.screenshot({ path: `${OUT}dossiers-1440.png` });
  await open(page, 'nominal', 'sources', 'dark');
  await page.screenshot({ path: `${OUT}sources-1440.png` });
  await open(page, 'nominal', 'journal', 'dark');
  await page.screenshot({ path: `${OUT}journal-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'nominal', '', 'dark');
  await page.getByTestId('view-outremer').click();
  await page.evaluate(() => document.querySelector('[data-testid=map-panel]')!.scrollIntoView());
  await page.screenshot({ path: `${OUT}carte-mobile-390.png` });
});
