// Renders one screenshot per minigame (bot demo, mid-game) into docs/screenshots/minigames/.
//   npm run dev   (in another terminal)
//   node scripts/mg-screenshots.mjs [baseUrl=http://localhost:5173] [outDir] [id,id,...]
// Uses the locally installed Chrome (GPU) – set CHROME=<path> if it lives elsewhere.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'docs/screenshots/minigames';
const only = process.argv[4]?.split(',');
const executablePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const IDS = [
  'kokosRegen', 'gipfelSprint', 'lavaSeil', 'schubsScholle', 'strichKuenstler', 'wackelBruecke', 'zaehlZoo', 'zehnSekunden',
  'flossRumble', 'paketKette', 'schatzTauziehen', 'tandemTretboot', 'weichenChaos',
  'ballonBombardement', 'kokosKanonier', 'laternenJagd', 'wandLabyrinth',
  'gipfelsturm', 'memoDuell', 'schnellzieher', 'schnickSchnack',
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

for (const id of only ?? IDS) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`  ! ${id}: ${e.message}`));
  const [mg, set] = id.split(':');
  await page.goto(`${base}/host?demo=kokosnuss&mg=${mg}${set ? `&mgset=${set}` : ''}`);
  try {
    await page.waitForFunction(() => window.__wb?.session?.debugState?.()?.minigamePhase === 'play', null, { timeout: 90000 });
  } catch {
    console.log(`✗ ${id} (did not reach play)`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(Number(process.env.WAIT ?? 6000));
  // a reload (e.g. HMR) restarts the demo: wait for play again before the shot
  await page.waitForFunction(() => window.__wb?.session?.debugState?.()?.minigamePhase === 'play', null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${id.replace(":", "-")}.jpg`, type: 'jpeg', quality: 85 });
  // WIDE=1: a second, wider shot of the backdrop (camera pulled back and lowered)
  if (process.env.WIDE) {
    await page.evaluate(() => {
      const { session, stage } = window.__wb;
      const view = session.runner?.view;
      if (view) view.followCamera = false;
      const c = stage.camera;
      stage.setCamera({ radius: c.radius * 1.9, beta: Math.min(1.3, c.beta + 0.3) }, 3, true);
    });
    await page.addStyleTag({ content: '#ui { visibility: hidden !important; }' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${id.replace(":", "-")}-wide.jpg`, type: 'jpeg', quality: 85 });
  }
  console.log(`✓ ${id}`);
  await page.close();
}
await browser.close();
