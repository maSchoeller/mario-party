import { expect, test } from '@playwright/test';
import { hostState, joinPhone, openHost } from './helpers';

test('lobby: QR/code join, chief role, unique characters, start with bots (LOBBY-01..04, GAME-01)', async ({ browser }) => {
  const { host, code } = await openHost(browser);
  expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}$/);
  await expect(host.locator('#room-code')).toHaveText(code);
  const anna = await joinPhone(browser, code, 'Anna');
  const ben = await joinPhone(browser, code, 'Ben');
  // first phone is chief and sees settings, second does not
  await expect(anna.locator('.settings')).toBeVisible();
  await expect(ben.locator('.settings')).toHaveCount(0);
  // characters are unique per lobby
  await expect(ben.locator('.char-card.selected')).not.toHaveText(await anna.locator('.char-card.selected').innerText());
  // P2P DataChannels come up in the local network (NET-01)
  await expect.poll(async () => (await hostState(host)).slots.map((s) => s.mode).join(','), { timeout: 15000 }).toBe('p2p,p2p');
  await anna.click('text=Vulkan-Gipfel');
  await anna.click('text=Spiel starten');
  await expect.poll(async () => (await hostState(host)).phase).toBe('game');
  const st = await hostState(host);
  expect(st.slots).toHaveLength(4);
  expect(st.slots.filter((s) => s.cpu)).toHaveLength(2);
  // turn order roll: Anna's phone shows the roll button
  await expect(anna.locator('.ctrl-big.roll')).toBeVisible({ timeout: 30000 });
  await anna.click('.ctrl-big.roll');
  await expect(ben.locator('.ctrl-big.roll')).toBeVisible({ timeout: 30000 });
});

test('forced WebSocket relay fallback works (NET-03)', async ({ browser }) => {
  const { host, code } = await openHost(browser, '&relay=1');
  const p = await joinPhone(browser, code, 'Relay', '&relay=1');
  await joinPhone(browser, code, 'Relay2', '&relay=1');
  await expect.poll(async () => (await hostState(host)).slots.map((s) => s.mode).join(',')).toBe('relay,relay');
  await p.click('text=Spiel starten');
  await expect(p.locator('.ctrl-big.roll')).toBeVisible({ timeout: 30000 });
});

test('phone reconnect keeps the seat, bot covers meanwhile (LOBBY-05, BOT-02, NET-06)', async ({ browser }) => {
  const { host, code } = await openHost(browser);
  const anna = await joinPhone(browser, code, 'Anna');
  const ben = await joinPhone(browser, code, 'Ben');
  await anna.click('text=Spiel starten');
  await expect.poll(async () => (await hostState(host)).phase).toBe('game');
  const ctx = ben.context();
  const url = ben.url();
  await ben.close();
  await expect.poll(async () => (await hostState(host)).slots[1].connected, { timeout: 15000 }).toBe(false);
  // while Ben is gone the game does not block: his order roll is done by a bot
  await anna.click('.ctrl-big.roll', { timeout: 30000 });
  await expect.poll(async () => (await hostState(host)).pending, { timeout: 30000 }).not.toBe('orderRoll');
  const ben2 = await ctx.newPage();
  await ben2.goto(url);
  await expect.poll(async () => (await hostState(host)).slots[1].connected, { timeout: 15000 }).toBe(true);
  expect((await hostState(host)).slots.map((s) => s.name)).toEqual(expect.arrayContaining(['Anna', 'Ben']));
  await expect(ben2.locator('.phone-header')).toContainText('Ben');
});

test('host reload resumes the running game and phones reconnect (SAVE-03)', async ({ browser }) => {
  const { host, code } = await openHost(browser);
  const anna = await joinPhone(browser, code, 'Anna');
  await joinPhone(browser, code, 'Ben');
  await anna.click('text=Spiel starten');
  await expect.poll(async () => (await hostState(host)).phase).toBe('game');
  await anna.click('.ctrl-big.roll', { timeout: 30000 });
  await host.reload();
  await host.waitForFunction(() => (window as any).__wb?.session.net.code);
  expect(await host.evaluate(() => (window as any).__wb.session.net.code)).toBe(code);
  await expect.poll(async () => (await hostState(host)).phase).toBe('game');
  await expect.poll(async () => (await hostState(host)).slots.filter((s) => s.connected).length, { timeout: 20000 }).toBe(2);
});

test('pause stops the game for everybody (SAVE-04)', async ({ browser }) => {
  const { host, code } = await openHost(browser);
  const anna = await joinPhone(browser, code, 'Anna');
  await joinPhone(browser, code, 'Ben');
  await anna.click('text=Spiel starten');
  await expect(anna.locator('.ctrl-big.roll')).toBeVisible({ timeout: 30000 });
  await anna.click('.ctrl-big.roll');
  await anna.locator('.chief-tools button').first().click({ timeout: 30000 });
  await expect(host.locator('.pause')).toBeVisible();
  await expect(anna.locator('.pause-overlay')).toBeVisible();
  await anna.click('.pause-overlay .primary');
  await expect(host.locator('.pause')).toHaveCount(0);
});

test('demo mode plays a minigame with bots only (BOT-03)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/host?quality=0&demo=kokosnuss&mg=gipfelSprint');
  await expect.poll(() => page.evaluate(() => (window as any).__wb?.session.debugState().minigamePhase), { timeout: 60000 }).toBe('play');
  expect(errors).toEqual([]);
});
