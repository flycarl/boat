import { expect, test, type Page } from '@playwright/test';

const enterDebugBattle = async (page: Page): Promise<void> => {
  await page.goto('/?debug=bridge');
  await page.locator('#player-name-input').fill('Projectile QA');
  await page.locator('#room-code-input').fill(String(1000 + Math.floor(Math.random() * 9000)));
  await page.locator('#join-button').click();
  await page.waitForFunction(() => Boolean(window.__BOAT_DEBUG__));
};

test('removes a projectile on impact and creates layered splash VFX', async ({ page }) => {
  await enterDebugBattle(page);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.enemies ?? 0)).toBeGreaterThan(0);
  const splashBefore = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.splashEvents ?? 0);

  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.cannonBalls ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__BOAT_DEBUG__?.hitFirstEnemyWithProjectile());

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.cannonBalls ?? 0)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.splashEvents ?? 0)).toBeGreaterThan(splashBefore);
});

test('removes an expired projectile and splashes where it enters the water', async ({ page }) => {
  await enterDebugBattle(page);
  const splashBefore = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.splashEvents ?? 0);

  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.cannonBalls ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => window.__BOAT_DEBUG__?.expireFirstProjectile());

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.cannonBalls ?? 0)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.splashEvents ?? 0)).toBeGreaterThan(splashBefore);
});
