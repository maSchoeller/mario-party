// Renders board screenshots of every map (bot demo) into docs/screenshots/.
//   npm run dev   (in another terminal)
//   node scripts/screenshots.mjs [baseUrl=http://localhost:5173]
// Uses the locally installed Chrome (GPU) – set CHROME=<path> if it lives elsewhere.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const executablePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync('docs/screenshots', { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

const shots = {
  kokosnuss: [
    ['overview', null],
    ['river', { target: [4, 1, 8], radius: 26, alpha: -1.75, beta: 0.95 }],
    ['jetty', { target: [12, 0.5, -27], radius: 22, alpha: -1.3, beta: 1.0 }],
  ],
  vulkan: [
    ['overview', null],
    ['crater', { target: [0, 3, 12], radius: 28, alpha: -1.5, beta: 1.0 }],
  ],
  bimmelbahn: [
    ['overview', null],
    ['canal', { target: [-12, 0.5, -24], radius: 24, alpha: -1.4, beta: 1.0 }],
  ],
};

for (const [map, list] of Object.entries(shots)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/host?demo=${map}`);
  await page.waitForFunction(() => window.__wb?.session?.board, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  for (const [name, cam] of list) {
    await page.evaluate((cam) => {
      const { session, stage } = window.__wb;
      session.paused = true;
      if (!cam) return session.board.overview(true);
      const { Vector3 } = Object.getPrototypeOf(stage.camera.target).constructor === undefined ? {} : { Vector3: stage.camera.target.constructor };
      stage.setCamera({ alpha: cam.alpha, beta: cam.beta, radius: cam.radius, target: new Vector3(...cam.target) }, 2.5, true);
    }, cam);
    // hide HUD overlays for clean pictures
    await page.addStyleTag({ content: '#ui, .hud, .subtitle, .card, .toast { visibility: hidden !important; }' }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `docs/screenshots/${map}-${name}.jpg`, type: 'jpeg', quality: 88 });
    console.log(`✓ ${map}-${name}`);
  }
  await page.close();
}
await browser.close();
