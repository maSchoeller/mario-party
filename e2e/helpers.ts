import type { Browser, Page } from '@playwright/test';

export async function openHost(browser: Browser, query = ''): Promise<{ host: Page; code: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctx.newPage();
  await host.goto(`/host?quality=0${query}`);
  await host.click('#create-lobby');
  await host.waitForFunction(() => (window as any).__wb?.session.net.code);
  const code = await host.evaluate(() => (window as any).__wb.session.net.code as string);
  return { host, code };
}

export async function joinPhone(browser: Browser, code: string, name: string, query = ''): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`/play?code=${code}${query}`);
  await p.fill('#name', name);
  await p.click('#join');
  await p.waitForSelector('.s-lobby');
  return p;
}

export function hostState(host: Page) {
  return host.evaluate(() => {
    const d = (window as any).__wb.session.debugState();
    return {
      phase: d.phase as string,
      slots: d.slots.map((s: any) => ({ name: s.name, connected: s.connected, mode: s.mode, cpu: s.cpu, character: s.character })),
      chief: d.chief as number | null,
      round: d.game?.round as number | undefined,
      pending: d.game?.pending?.kind as string | undefined,
      pendingPlayer: d.game?.pending?.player as number | undefined,
      stage: d.game?.stage as string | undefined,
    };
  });
}
