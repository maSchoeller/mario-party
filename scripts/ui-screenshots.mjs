// UI review shots of every overlay screen (TV + phone) into docs/screenshots/ui/<tag>/.
//   npm run dev   (in another terminal)
//   node scripts/ui-screenshots.mjs [baseUrl=http://localhost:5173] [tag=current]
// Uses the locally installed Chrome (GPU) – set CHROME=<path> if it lives elsewhere.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const tag = process.argv[3] ?? 'current';
const out = `docs/screenshots/ui/${tag}`;
mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

const shot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 });
  console.log(`✓ ${name}`);
};
const tv = () => browser.newContext({ viewport: { width: 1600, height: 900 } }).then((c) => c.newPage());
const phone = () => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 }).then((c) => c.newPage());
const hostState = (host) => host.evaluate(() => {
  const d = window.__wb.session.debugState();
  return { phase: d.phase, pending: d.game?.pending?.kind, player: d.game?.pending?.player };
});
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// ---------------------------------------------------------------- landing + start
{
  const p = await tv();
  await p.goto(`${base}/`);
  await p.waitForTimeout(800);
  await shot(p, 'tv-landing');
  const m = await phone();
  await m.goto(`${base}/`);
  await m.waitForTimeout(800);
  await shot(m, 'phone-landing');
  await p.context().close();
  await m.context().close();
}

// ---------------------------------------------------------------- lobby + board session
const host = await tv();
await host.goto(`${base}/host`);
await host.waitForSelector('#create-lobby');
await host.waitForTimeout(1500);
await shot(host, 'tv-start');
await host.click('#create-lobby');
await host.waitForFunction(() => window.__wb?.session.net.code);
const code = await host.evaluate(() => window.__wb.session.net.code);
await host.waitForTimeout(1500);
await shot(host, 'tv-lobby-empty');

const anna = await phone();
await anna.goto(`${base}/play?code=${code}`);
await anna.waitForSelector('#name');
await anna.waitForTimeout(500);
await shot(anna, 'phone-join');
await anna.fill('#name', 'Anna');
await anna.click('#join');
await anna.waitForSelector('.s-lobby');
const ben = await phone();
await ben.goto(`${base}/play?code=${code}`);
await ben.fill('#name', 'Ben');
await ben.click('#join');
await ben.waitForSelector('.s-lobby');
await anna.waitForTimeout(1200);
await shot(anna, 'phone-lobby-chief');
await anna.screenshot({ path: `${out}/phone-lobby-chief-full.jpg`, type: 'jpeg', quality: 85, fullPage: true });
await shot(ben, 'phone-lobby');
await shot(host, 'tv-lobby');

await anna.click('text=Spiel starten');
await until(async () => (await hostState(host)).phase === 'game');
await until(() => anna.locator('.ctrl-big.roll').isVisible(), 45000);
await host.waitForTimeout(1500);
await shot(host, 'tv-board-order');
await shot(anna, 'phone-order-roll');
await shot(ben, 'phone-wait');
await anna.click('.ctrl-big.roll');
await host.waitForTimeout(1600);
await shot(host, 'tv-dice-result');
await until(() => ben.locator('.ctrl-big.roll').isVisible(), 45000);
await ben.click('.ctrl-big.roll');
// first real turn: whoever gets the turn menu
const turn = await until(async () => (await anna.locator('.dice-pick').count()) || (await ben.locator('.dice-pick').count()), 120000);
if (turn) {
  const who = (await anna.locator('.dice-pick').count()) ? anna : ben;
  await who.waitForTimeout(600);
  await shot(who, 'phone-turn-menu');
  await shot(host, 'tv-board-turn');
}
await host.context().close();
await anna.context().close();
await ben.context().close();

// ---------------------------------------------------------------- minigame HUD (bot demo) + overlays fed with sample data
{
  const p = await tv();
  await p.goto(`${base}/host?demo=kokosnuss&mg=kokosRegen`);
  if (await until(() => p.locator('.layer-mg .timer').isVisible(), 60000)) {
    await p.waitForTimeout(6000);
    await shot(p, 'tv-mg-hud');
  }
  await until(() => p.locator('.pcard').first().isVisible(), 90000);
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const { session } = window.__wb;
    session.paused = true;
    const ui = session.ui;
    const players = [
      { color: 'red', character: 'rocco' },
      { color: 'blue', character: 'quaki' },
      { color: 'green', character: 'foxy' },
      { color: 'yellow', character: 'hoppla' },
    ];
    ui.minigameIntro('kokosRegen', 'ffa', players, ['Anna', 'Ben', 'Foxy', 'Hoppla'], [true, false, true, true], 12, [], ['joystick']);
  });
  await p.waitForTimeout(800);
  await shot(p, 'tv-mg-intro');
  await p.evaluate(() => {
    const ui = window.__wb.session.ui;
    void ui.results('Kokos-Regen', [
      { name: 'Anna', color: 'red', character: 'rocco', rank: 0, reward: '+10 ●' },
      { name: 'Ben', color: 'blue', character: 'quaki', rank: 1, reward: '+5 ●' },
      { name: 'Foxy', color: 'green', character: 'foxy', rank: 2, reward: '+2 ●' },
      { name: 'Hoppla', color: 'yellow', character: 'hoppla', rank: 3, reward: '' },
    ], 60000);
  });
  await p.waitForTimeout(800);
  await shot(p, 'tv-mg-results');
  await p.evaluate(() => {
    const ui = window.__wb.session.ui;
    ui.setOverlay(null);
    ui.pause(true, 'K7Q2PX');
  });
  await p.waitForTimeout(500);
  await shot(p, 'tv-pause');
  await p.context().close();
}
{
  const p = await tv();
  await p.goto(`${base}/host?demo=vulkan&ff=1`);
  await until(() => p.locator('.pcard').first().isVisible(), 60000);
  await p.waitForTimeout(6000);
  await shot(p, 'tv-board-demo');
  await p.context().close();
}
await browser.close();
