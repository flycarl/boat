import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?debug=bridge');
  await page.locator('#player-name-input').fill('Systems QA');
  await page.locator('#room-code-input').fill('0000');
  await page.locator('#join-button').click();
  await page.waitForFunction(() => Boolean(window.__BOAT_DEBUG__));
});

test('cargo is secured at the bank and survives as spendable battle coins', async ({ page }) => {
  await page.evaluate(() => {
    window.__BOAT_DEBUG__?.setCargo(64);
    window.__BOAT_DEBUG__?.goToBank();
  });

  await expect(page.locator('#bank-overlay')).toHaveClass(/visible/);
  await expect(page.locator('#bank-cargo-coins')).toHaveText('+64');
  await expect(page.locator('#bank-battle-coins')).toHaveText('64');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cargoCoins)).toBe(0);
});

test('three-choice dock spends secured coins and closes after one choice', async ({ page }) => {
  await page.evaluate(() => {
    window.__BOAT_DEBUG__?.setCoins(500);
    window.__BOAT_DEBUG__?.goToUpgrade();
  });

  await expect(page.locator('#upgrade-overlay')).toHaveClass(/visible/);
  await expect(page.locator('.upgrade-actions button')).toHaveCount(3);
  await expect(page.locator('.upgrade-actions button').first()).toContainText('Lv.');
  await page.locator('.upgrade-actions button').first().click();
  await expect(page.locator('#upgrade-overlay')).not.toHaveClass(/visible/);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.coins ?? 500)).toBeLessThan(500);
});

test('wanted, subsystem damage, and sea events publish player-facing state', async ({ page }) => {
  await page.evaluate(() => {
    window.__BOAT_DEBUG__?.setWanted(3);
    window.__BOAT_DEBUG__?.damagePart('rudder');
    window.__BOAT_DEBUG__?.spawnSeaEvent('storm');
  });

  await expect(page.locator('#wanted-value')).toContainText('★3');
  await expect(page.locator('#part-damage-value')).toContainText('断舵');
  await expect(page.locator('#sea-event-kind')).toHaveText('黑潮风暴');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.wanted.bounty)).toBe(135);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.seaEvent?.kind)).toBe('storm');
});

test('three rapid gold pickups activate the x2 combo', async ({ page }) => {
  for (let index = 0; index < 3; index += 1) {
    await page.evaluate(() => window.__BOAT_DEBUG__?.collectNearestGold());
    await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.entities.coinFlights ?? 0)).toBeGreaterThan(0);
    await page.waitForTimeout(820);
  }

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.combo.multiplier)).toBe(2);
  await expect(page.locator('#combo-badge')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.cargoCoins ?? 0)).toBeGreaterThan(0);
});
