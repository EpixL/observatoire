import { expect, test } from '@playwright/test';
import { open, watchRequests } from './helpers';

const WIDTHS = [320, 390, 768, 1440];
const ROUTES = ['vue', 'dossiers', 'carte', 'sources', 'journal', 'reglages/general', 'reglages/sources', 'reglages/notifications', 'reglages/seuils'];
const SCENARIOS = ['nominal', 'indisponible', 'ambigu', 'civile', 'nucleaire', 'methode', 'partielle', 'seuils'];

test.describe('mise en page', () => {
  for (const w of WIDTHS) {
    test(`aucun défilement horizontal à ${w} px (toutes pages, tous scénarios)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      for (const s of SCENARIOS) {
        for (const r of ROUTES) {
          await open(page, s, r);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(over, `${s}/${r} à ${w}px`).toBeLessThanOrEqual(0);
        }
      }
    });
  }

  test('ordinateur : colonne gauche ≈ 25 %, carte ≈ 75 %', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const left = await page.locator('.col-left').boundingBox();
    const main = await page.locator('.col-main').boundingBox();
    const total = left!.width + main!.width;
    expect(left!.width / total).toBeGreaterThan(0.2);
    expect(left!.width / total).toBeLessThan(0.3);
  });

  test('téléphone : ordre vertical du plan (jauge, interprétation, carte, fiche, liste) et carte visible sans onglet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const y = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    const order = [await y('.gauge'), await y('[data-testid=conclusion]'), await y('[data-testid=map-panel]'), await y('[data-testid=event-card]'), await y('[data-testid=event-list]'), await y('[data-testid=hypotheses]'), await y('[data-testid=coverage]')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(page.getByTestId('map-svg')).toBeVisible();
  });

  test('téléphone : cibles tactiles ≥ 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const r of ROUTES) {
      await open(page, 'nominal', r);
      // les liens/boutons « en ligne » dans une phrase sont exemptés (WCAG 2.5.8)
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('button:not(.ref), a:not(.skip), select, summary, input, [role=tab]')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('dialog:not([open])'))
          .map((el) => ({ el, r: el.getBoundingClientRect(), label: el.closest('label') }))
          .filter(({ r, label }) => !(label && label.getBoundingClientRect().height >= 44) && (r.height < 43.5 || r.width < 43.5))
          .filter(({ el }) => !(el.tagName === 'A' && el.closest('p')))
          .map(({ el, r }) => `${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      expect(small, `route ${r}`).toEqual([]);
    }
  });

  test('marqueurs : zone tactile ≥ 44 px à l’écran', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const hit = page.locator('[data-testid^=marker-], [data-testid^=cluster-]').first();
    const b = await hit.boundingBox();
    expect(b!.width).toBeGreaterThanOrEqual(43);
  });
});

test.describe('états particuliers (section 10)', () => {
  test('bandeau « Données fictives — maquette » permanent sur chaque page', async ({ page }) => {
    for (const r of ROUTES) {
      await open(page, 'nominal', r);
      await expect(page.getByText('Données fictives — maquette').first()).toBeVisible();
    }
  });
  test('données indisponibles : tiret, jauge grisée, dernière valeur datée, jamais 0', async ({ page }) => {
    await open(page, 'indisponible');
    const svg = page.locator('.gauge svg');
    await expect(svg).toHaveAttribute('aria-label', /non calculable/);
    await expect(svg.locator('.g-num')).toHaveText('—');
    await expect(page.locator('.gauge .last-known')).toContainText('Dernière valeur connue');
    await expect(page.getByTestId('conclusion')).toContainText('Conclusion suspendue');
    await expect(page.getByTestId('coverage')).toContainText('non satisfait');
  });
  test('situation ambiguë : plusieurs interprétations, aucun vainqueur', async ({ page }) => {
    await open(page, 'ambigu');
    await expect(page.getByTestId('conclusion')).toContainText('Plusieurs interprétations restent possibles');
    await expect(page.getByTestId('hypotheses').locator('.verdict.soutenue')).toHaveCount(0);
  });
  test('alerte civile majeure : bandeau au-dessus du cadran, jauge basse', async ({ page }) => {
    await open(page, 'civile');
    const banner = await page.getByTestId('civil-banner').boundingBox();
    const gauge = await page.locator('.gauge').boundingBox();
    expect(banner!.y + banner!.height).toBeLessThanOrEqual(gauge!.y);
    await expect(page.getByTestId('civil-banner')).toContainText('Consigne officielle');
    await expect(page.locator('.gauge svg')).toHaveAttribute('aria-label', /10 sur 100/);
  });
  test('badge nucléaire / radiologique : quatre états distingués, état actuel marqué', async ({ page }) => {
    await open(page, 'nucleaire');
    const b = page.getByTestId('nuclear-badge');
    await expect(b.locator('li')).toHaveCount(4);
    await expect(b.locator('li[aria-current=true]')).toContainText('Alerte radiologique');
    await expect(b).toContainText('absence de badge');
  });
  test('changement de méthode : bandeau, tendance non comparable, marqueur dans l’historique', async ({ page }) => {
    await open(page, 'methode');
    await expect(page.getByTestId('method-banner')).toContainText('tendance est suspendue');
    await expect(page.locator('.gauge')).toContainText('tendance non comparable');
    await expect(page.getByTestId('history').locator('.mchg')).toHaveCount(1);
  });
  test('fait grave + couverture partielle : palier documenté avec badge', async ({ page }) => {
    await open(page, 'partielle');
    await expect(page.locator('.gauge')).toContainText('Couverture partielle');
    await expect(page.locator('.gauge svg')).toHaveAttribute('aria-label', /70 sur 100/);
  });
  test('historique en escalier : intervalle sans mesure signalé, aucune courbe oblique', async ({ page }) => {
    await open(page);
    const d = await page.locator('.hist .step').evaluateAll((els) => els.map((e) => e.getAttribute('d')));
    expect(d.length).toBeGreaterThanOrEqual(2); // interrompu par le trou de collecte
    for (const p of d) expect(p).not.toMatch(/[LCQ]/);
    await expect(page.getByTestId('history')).toContainText('Pas de mesure');
  });
  test('échelle : définitions de 0, des paliers, de 100 et de « non calculable »', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Comprendre l’échelle' }).click();
    const dlg = page.getByRole('dialog', { name: 'Comprendre l’échelle' });
    await expect(dlg.locator('.scale-table li')).toHaveCount(9);
    await expect(dlg).toContainText('Aucun signal qualifiant observé');
    await expect(dlg).toContainText('Conflit armé direct en cours');
    await expect(dlg).toContainText('Non calculable');
    await expect(dlg).toContainText('non probabilistes');
  });
});

test.describe('carte', () => {
  test('sélection synchronisée marqueur ↔ liste ↔ fiche', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await page.getByTestId('view-europe').click();
    await page.getByTestId('marker-EV-001').click();
    await expect(page.getByTestId('event-card')).toContainText('Restriction aérienne temporaire');
    await expect(page.getByTestId('ev-EV-001')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('ev-EV-004').click();
    await expect(page.getByTestId('event-card')).toContainText('Exercice militaire annoncé');
    await expect(page.getByTestId('ev-EV-001')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('event-card')).toContainText('Critère non rempli');
  });
  test('vues France / Europe / Monde et outre-mer ; le territoire évalué ne change pas', async ({ page }) => {
    await open(page);
    const zone = await page.locator('.header .zone strong').textContent();
    for (const v of ['europe', 'monde', 'france']) {
      await page.getByTestId(`view-${v}`).click();
      await expect(page.getByTestId(`view-${v}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.header .zone strong')).toHaveText(zone!);
    }
    await page.getByTestId('view-outremer').click();
    await expect(page.getByTestId('overseas').locator('figure')).toHaveCount(8);
    await expect(page.getByTestId('marker-EV-007')).toBeVisible();
  });
  test('couches sélectionnables : masquer une couche ne supprime que l’affichage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await page.getByTestId('view-europe').click();
    await expect(page.getByTestId('marker-EV-001')).toBeVisible();
    await page.getByTestId('layer-restrictions').click();
    await expect(page.getByTestId('marker-EV-001')).toHaveCount(0);
    await expect(page.getByTestId('layer-satellite')).toBeDisabled();
    await page.getByTestId('layer-restrictions').click();
    await expect(page.getByTestId('marker-EV-001')).toBeVisible();
  });
  test('liste « non localisé », exclus avec motif, retenus seulement', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('unlocated-head')).toContainText('(1)');
    await page.getByRole('button', { name: 'Afficher les éléments exclus' }).click();
    await page.getByTestId('ev-EV-009').click();
    await expect(page.getByTestId('event-card')).toContainText('Doublon');
    await page.getByRole('button', { name: /retenus dans l’évaluation/ }).click();
    await expect(page.getByTestId('ev-EV-004')).toHaveCount(0);
    await expect(page.getByTestId('ev-EV-001')).toBeVisible();
  });
  test('reprises d’une même dépêche : une origine, pas trois confirmations', async ({ page }) => {
    await open(page);
    await page.getByTestId('ev-EV-005').click();
    await expect(page.getByTestId('event-card')).toContainText('1 origine indépendante');
    await expect(page.getByTestId('event-card')).toContainText('Plusieurs reprises');
  });
  test('un événement hors de la vue courante propose de changer de vue', async ({ page }) => {
    await open(page);
    await page.getByTestId('view-france').click();
    await page.getByTestId('ev-EV-002').click();
    await page.getByRole('button', { name: 'Passer à la vue Europe' }).click();
    await expect(page.getByTestId('view-europe')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('dossiers et IA factice', () => {
  test('onglets (flèches), IA : confirmation du coût, aucune requête', async ({ page }) => {
    const external = watchRequests(page);
    await open(page, 'nominal', 'dossiers');
    await expect(page.getByTestId('tab-regles')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('tab-regles').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-elements')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-ia')).toBeFocused();
    await page.getByTestId('ai-button').click();
    const dlg = page.getByRole('dialog', { name: 'Approfondir avec l’IA' });
    await expect(dlg).toContainText('Coût maximum estimé');
    const c1 = await dlg.getByTestId('ai-cost').textContent();
    await dlg.getByRole('radio', { name: /Inclure une recherche/ }).check();
    expect(await dlg.getByTestId('ai-cost').textContent()).not.toBe(c1);
    await dlg.getByTestId('ai-confirm').click();
    await expect(page.getByTestId('ai-done')).toContainText('aucune requête n’a été envoyée');
    expect(external).toEqual([]);
  });
  test('IA désactivée : message, reste utilisable', async ({ page }) => {
    await open(page, 'nominal', 'reglages/general');
    await page.getByLabel(/Désactivée/).check();
    await page.goto(page.url().replace(/#.*/, '#/dossiers'));
    await page.getByTestId('tab-ia').click();
    await expect(page.locator('#panel-ia')).toContainText('désactivé');
    await expect(page.getByTestId('ai-button')).toHaveCount(0);
    await page.getByTestId('tab-regles').click();
    await expect(page.locator('#panel-regles')).toContainText('Durcissement des précautions');
  });
});

test.describe('clavier, focus et zéro appel externe', () => {
  test('lien d’évitement, navigation, dialogue (Échap, retour du focus)', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    const btn = page.getByRole('button', { name: 'Comprendre l’échelle' });
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(btn).toBeFocused();
  });
  test('focus toujours visible (contour ≥ 2 px)', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const ow = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement!).outlineWidth));
    expect(ow).toBeGreaterThanOrEqual(2);
  });
  test('sélection d’un élément au clavier depuis la liste', async ({ page }) => {
    await open(page);
    await page.getByTestId('ev-EV-003').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('event-card')).toContainText('conseil aux voyageurs');
  });
  test('aucune requête externe, sur aucune page ni scénario', async ({ page }) => {
    const external = watchRequests(page);
    for (const s of SCENARIOS) for (const r of ROUTES) await open(page, s, r);
    expect(external).toEqual([]);
  });
  test('navigation principale : cinq entrées, page courante marquée', async ({ page }) => {
    await open(page);
    const links = page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link');
    await expect(links).toHaveCount(5);
    await links.nth(3).click();
    await expect(page.getByTestId('sources')).toBeVisible();
    await expect(links.nth(3)).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('thème et flanc est', () => {
  test.use({ colorScheme: 'light' });
  test('bleu nuit par défaut même si le système est en mode clair', async ({ page }) => {
    await open(page, 'nominal', '', null);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(10, 19, 37)');
  });
  test('choix manuel du thème clair, mémorisé', async ({ page }) => {
    await open(page, 'nominal', 'reglages/general', null);
    await page.getByLabel(/Clair — accessible/).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('événements fictifs : pays réels, bandeau permanent', () => {
  test('zone : France + flanc est (PL, LT, LV, BY, MD, RU, UA)', async ({ page }) => {
    await open(page);
    for (const [id, pays] of [['EV-001', 'Pologne'], ['EV-002', 'Lituanie'], ['EV-003', 'Moldavie'], ['EV-004', 'Russie'], ['EV-005', 'Lettonie'], ['EV-006', 'Biélorussie'], ['EV-013', 'Ukraine'], ['EV-007', 'Nouvelle-Calédonie']]) {
      await page.getByTestId(`ev-${id}`).click();
      await expect(page.getByTestId('event-card')).toContainText(pays);
      await expect(page.getByTestId('event-card')).toContainText('Donnée fictive');
    }
  });
  test('bandeau DONNÉES FICTIVES visible partout, aussi sur la carte et dans Réglages', async ({ page }) => {
    for (const r of ROUTES) {
      await open(page, 'nominal', r);
      const bar = page.locator('.demo-bar strong');
      await expect(bar).toBeVisible();
      expect(await bar.evaluate((e) => getComputedStyle(e).textTransform)).toBe('uppercase');
    }
    await open(page);
    await expect(page.locator('.map-badge')).toBeVisible();
  });
  test('liens proposés : jamais une preuve', async ({ page }) => {
    await open(page);
    await page.getByTestId('ev-EV-001').click();
    await expect(page.getByTestId('event-card')).toContainText('Cause commune possible');
    await expect(page.getByTestId('event-card')).toContainText('non établie');
  });
});

test.describe('réglages', () => {
  test('état des sources : lecture seule, quatre verdicts, motif', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, 'indisponible', 'reglages/sources');
    const p = page.getByTestId('sources-status');
    await expect(p.locator('thead th')).toHaveText(['Source', 'Famille', 'Dernier passage', 'Verdict', 'Motif']);
    for (const v of ['OK', 'BLOCKED', 'FAIL', 'SKIPPED']) await expect(p.locator(`.verdict-badge.${v}`).first()).toBeVisible();
    await expect(p).toContainText('anti-robot');
    await expect(p.locator('input, button, select, textarea')).toHaveCount(0);
  });
  test('état des sources sur téléphone : cartes lisibles', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'nominal', 'reglages/sources');
    await expect(page.getByTestId('sources-status').locator('li.src-row')).toHaveCount(9);
  });
  test('notifications : choix « officielles + A3 », interrupteur, canal non activé', async ({ page }) => {
    await open(page, 'nominal', 'reglages/notifications');
    await expect(page.getByLabel(/officielles \+ changements majeurs \(A3\)/)).toBeChecked();
    await expect(page.getByTestId('notifications')).toContainText('non activé');
    await page.getByTestId('notif-enabled').uncheck();
    await expect(page.getByLabel(/officielles seulement/)).toBeDisabled();
    await page.getByTestId('notif-enabled').check();
    await page.getByLabel(/analyses approfondies \(A2\)/).check();
    await expect(page.getByLabel(/analyses approfondies \(A2\)/)).toBeChecked();
  });
  test('seuils : garde-fous (limites, confirmation, motif, historique, retour au plan, indicateur sur la jauge)', async ({ page }) => {
    await open(page, 'nominal', 'reglages/seuils');
    await expect(page.getByTestId('comparability')).toContainText('moins comparables');
    await expect(page.getByTestId('thr-status')).toContainText('conformes au plan');
    await expect(page.getByTestId('thr-save')).toBeDisabled();
    // limite de sécurité
    const k = page.getByTestId('thr-anomaly_mad_k');
    await k.fill('9');
    await expect(page.getByRole('alert')).toContainText('limites de sécurité');
    await expect(page.getByTestId('thr-save')).toBeDisabled();
    // changement valide : confirmation obligatoire, motif obligatoire
    await k.fill('2.5');
    await page.getByTestId('thr-save').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('3 → 2,5');
    await expect(dlg).toContainText('moins comparables');
    await expect(page.getByTestId('thr-confirm')).toBeDisabled();
    await page.getByTestId('thr-reason').fill('court');
    await page.getByTestId('thr-ack').check();
    await expect(page.getByTestId('thr-confirm')).toBeDisabled(); // motif < 8 caractères
    await page.getByTestId('thr-reason').fill('Essai de détection plus précoce');
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-status')).toContainText('1 seuil différent du plan');
    const hist = page.getByTestId('thr-history');
    await expect(hist).toContainText('Essai de détection plus précoce');
    await expect(hist).toContainText('seuils-v2');
    // indicateur sur la jauge + tendance non comparable + marqueur d'historique
    await page.getByTestId('nav-vue').click();
    await expect(page.getByTestId('thresholds-flag')).toContainText('Seuils modifiés (1)');
    await expect(page.locator('.gauge')).toContainText('tendance non comparable');
    await expect(page.getByTestId('history').locator('.mchg')).toHaveCount(1);
    await page.getByRole('button', { name: 'Comprendre l’échelle' }).click();
    await expect(page.getByTestId('scale-thr-note')).toBeVisible();
    await page.keyboard.press('Escape');
    // retour aux valeurs du plan : confirmation + motif, historique conservé
    await page.getByTestId('thresholds-flag').getByRole('link').click();
    await page.getByTestId('thr-reset').click();
    await page.getByTestId('thr-reason').fill('Retour à la référence du plan');
    await page.getByTestId('thr-ack').check();
    await page.getByTestId('thr-confirm').click();
    await expect(page.getByTestId('thr-status')).toContainText('conformes au plan');
    await expect(hist.locator('li')).toHaveCount(2);
    await expect(hist).toContainText('Retour au plan');
    await expect(hist).toContainText('Essai de détection plus précoce');
    await page.getByTestId('nav-vue').click();
    await expect(page.getByTestId('thresholds-flag')).toHaveCount(0);
  });
  test('seuils : scénario déjà modifié (indicateur, historique daté, tendance non comparable)', async ({ page }) => {
    await open(page, 'seuils');
    await expect(page.getByTestId('thresholds-flag')).toContainText('Seuils modifiés (2)');
    await expect(page.locator('.gauge')).toContainText('seuils modifiés');
    await page.getByTestId('thresholds-flag').getByRole('link').click();
    await expect(page.getByTestId('thr-history').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('thr-history')).toContainText('Motif');
  });
});
