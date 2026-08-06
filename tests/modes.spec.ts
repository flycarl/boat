import { expect, test } from '@playwright/test';

async function enterMode(page: import('@playwright/test').Page, mode: 'brawl' | 'treasure' | 'hunt'): Promise<void> {
  await page.goto('/?debug=bridge');
  await page.locator(`input[name="gameMode"][value="${mode}"]`).check();
  await page.locator('#player-name-input').fill('Mode QA');
  await page.locator('#room-code-input').fill('2468');
  await page.locator('#join-button').click();
  await page.waitForFunction(() => Boolean(window.__BOAT_DEBUG__ && window.__THREE_GAME_DIAGNOSTICS__));
}

test('homepage offers three persistent game modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[name="gameMode"]')).toHaveCount(3);
  await expect(page.locator('input[name="gameMode"][value="brawl"]')).toBeChecked();

  await page.locator('input[name="gameMode"][value="treasure"]').check();
  await expect(page.locator('#join-button')).toHaveText('进入淘金撤离');
  await page.reload();
  await expect(page.locator('input[name="gameMode"][value="treasure"]')).toBeChecked();
});

test('treasure mode starts with gold and completes its banking objective', async ({ page }) => {
  await enterMode(page, 'treasure');

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode.id)).toBe('treasure');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.goldCoins ?? 0)).toBeGreaterThanOrEqual(9);
  await page.evaluate(() => {
    window.__BOAT_DEBUG__?.setCargo(500);
    window.__BOAT_DEBUG__?.goToBank();
  });
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode.goalReached)).toBe(true);
  await expect(page.locator('#mode-objective')).toContainText('500 / 500');
});

test('hunt mode announces its objective and spawns a boss quickly', async ({ page }) => {
  await enterMode(page, 'hunt');

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.mode.id)).toBe('hunt');
  await expect(page.locator('#mode-objective')).toHaveText('0 / 3 巨兽已击败');
  await expect(page.locator('#boss-hud')).toHaveClass(/visible/, { timeout: 7_000 });
  await expect(page.locator('#boss-hp-value')).toContainText('/ 1400');
});
