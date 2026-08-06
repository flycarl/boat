import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('buys, equips, and persists a level skin with home coins', async ({ page }, testInfo) => {
  await page.evaluate(() => localStorage.setItem('boat.profile.v1', JSON.stringify({
    homeCoins: 10,
    ownedSkinIds: [],
    equippedSkins: {},
  })));
  await page.reload();

  await expect(page.locator('#home-coin-value')).toHaveText('10');
  await page.locator('#open-skin-shop').click();
  await expect(page.locator('#skin-shop-overlay')).toHaveClass(/visible/);
  await page.waitForTimeout(220);
  await testInfo.attach('skin-shop', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.locator('#skin-level-tabs button')).toHaveCount(12);
  await expect(page.locator('.skin-card')).toHaveCount(3);
  const firstSkin = page.locator('.skin-card').first();
  await expect(firstSkin).toContainText('漂流木筏');
  await firstSkin.locator('button').click();
  await expect(firstSkin.locator('button')).toHaveText('已装备');
  await expect(page.locator('#shop-coin-value')).toHaveText('3');

  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('boat.profile.v1') ?? '{}'));
  expect(profile.homeCoins).toBe(3);
  expect(profile.ownedSkinIds).toContain('level-1-sunwake');
  expect(profile.equippedSkins['1']).toBe('level-1-sunwake');
});

test('bank converts each 25 battle coins into one persistent home coin', async ({ page }, testInfo) => {
  await page.goto('/?debug=bridge');
  await page.locator('#player-name-input').fill('Bank QA');
  await page.locator('#room-code-input').fill('0000');
  await page.locator('#join-button').click();
  await page.waitForFunction(() => Boolean(window.__BOAT_DEBUG__));
  await page.evaluate(() => {
    window.__BOAT_DEBUG__?.setCoins(74);
    window.__BOAT_DEBUG__?.goToBank();
  });
  await expect(page.locator('#bank-overlay')).toHaveClass(/visible/);
  await expect(page.locator('#bank-battle-coins')).toHaveText('74');
  await page.waitForTimeout(220);
  await testInfo.attach('bank', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('#bank-exchange-all').click();
  await expect(page.locator('#bank-battle-coins')).toHaveText('24');
  await expect(page.locator('#bank-home-coins')).toHaveText('2');

  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('boat.profile.v1') ?? '{}'));
  expect(profile.homeCoins).toBe(2);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.bankOpen)).toBe(true);
});

test('equipped level skin is applied to the player ship', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('boat.profile.v1', JSON.stringify({
    homeCoins: 0,
    ownedSkinIds: ['level-1-abyss'],
    equippedSkins: { 1: 'level-1-abyss' },
  })));
  await page.goto('/?debug=bridge');
  await page.locator('#player-name-input').fill('Skin QA');
  await page.locator('#room-code-input').fill('0000');
  await page.locator('#join-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.skinId)).toBe('level-1-abyss');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.skinEffectMeshes ?? 0)).toBeGreaterThan(8);
});

test('upgrading to an unskinned level clears the previous level skin', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('boat.profile.v1', JSON.stringify({
    homeCoins: 0,
    ownedSkinIds: ['level-1-abyss'],
    equippedSkins: { 1: 'level-1-abyss' },
  })));
  await page.goto('/?debug=bridge');
  await page.locator('#player-name-input').fill('Level Skin QA');
  await page.locator('#room-code-input').fill('0000');
  await page.locator('#join-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.skinId)).toBe('level-1-abyss');

  await page.evaluate(() => window.__BOAT_DEBUG__?.setHullLevel(2));

  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.skinId)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.skinEffectMeshes ?? -1)).toBe(0);
});
