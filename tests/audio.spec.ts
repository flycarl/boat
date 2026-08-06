import { expect, test } from '@playwright/test';

test('unlocks sailing audio and triggers cannon and coin sounds', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?debug=1');
  await page.locator('#player-name-input').fill('Audio QA');
  await page.locator('#room-code-input').fill('0000');
  await page.locator('#join-button').click();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 15);

  await expect
    .poll(() => page.evaluate(() => {
      const audio = window.__THREE_GAME_DIAGNOSTICS__?.audio;
      return Boolean(audio?.unlocked && audio.contextState === 'running' && audio.ambienceActive);
    }))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.sailingLevel ?? 0))
    .toBeGreaterThan(0.4);

  const cannonBefore = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.events.cannon ?? 0);
  await page.keyboard.press('KeyF');
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.events.cannon ?? 0))
    .toBeGreaterThan(cannonBefore);

  const pickupBefore = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.events.pickup ?? 0);
  await page.evaluate(() => window.__BOAT_DEBUG__?.collectNearestGold());
  await expect.poll(() => page.locator('.coin-flight').count()).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.coinFlights ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.events.pickup ?? 0))
    .toBeGreaterThan(pickupBefore);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cargoCoins ?? 0))
    .toBeGreaterThan(0);
  await expect.poll(() => page.locator('.coin-flight').count()).toBe(0);

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
