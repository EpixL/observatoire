import type { Page } from '@playwright/test';

/** Échoue si la page émet la moindre requête hors de son origine (aucun appel externe à l'exécution). */
export function watchRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    if (!u.startsWith('http://127.0.0.1')) external.push(u);
  });
  return external;
}

/** Territoire sur lequel chaque scénario raconte son histoire (voir STORY_TERRITORY des mocks) ; l'autre territoire est « calme ». */
const STORY: Record<string, string> = { civile: 'FR', partielle: 'FR' };

export async function open(page: Page, scenario = 'nominal', route = '', theme: 'dark' | 'light' | null = 'dark', query = '') {
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('veille-theme', t), theme);
  const territory = query.includes('territory=') ? '' : `&territory=${STORY[scenario] ?? 'flanc-est'}`;
  await page.goto(`/?scenario=${scenario}${territory}${query}#/${route}`);
  await page.waitForSelector('main');
}
