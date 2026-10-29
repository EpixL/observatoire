import { test } from '@playwright/test';
const S = '/tmp/claude-0/-home-user-observatoire/7a9a7ae5-1e03-5b9e-9c33-07ff6d2fdae8/scratchpad';
test('mobile top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?scenario=nominal');
  await page.screenshot({ path: `${S}/m1.png` });
  await page.evaluate(() => window.scrollTo(0, 820));
  await page.screenshot({ path: `${S}/m2.png` });
});
