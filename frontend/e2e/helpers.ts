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

export async function open(page: Page, scenario = 'nominal', route = '', theme: 'dark' | 'light' | null = 'dark') {
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('veille-theme', t), theme);
  await page.goto(`/?scenario=${scenario}#/${route}`);
  await page.waitForSelector('main');
}
