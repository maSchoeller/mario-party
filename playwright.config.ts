import { defineConfig } from '@playwright/test';

/** End-to-end tests: real browsers for host (TV) and phones against the dev servers. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
      executablePath: process.env.PW_CHROMIUM ?? undefined,
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { SAVE_STORE: 'memory' },
  },
});
