/**
 * What phone.spec.mts and phone-chart.spec.mts share (8 Oct 2026). The review
 * of audit package D found that nothing held the phone layouts it changed -
 * mobile-1, 2, 3, 4, 6 and 10 were each checked once by hand in Chromium - so
 * these two specs hold them, one per fixture state.
 *
 * As the other e2e/app specs: Playwright from ~/code/.parity, its surface typed
 * by hand, and the fixture served by `next start` in-process on the build. Or
 * by a server already running in fixture mode at E2E_BASE, which must be
 * serving the state the spec asks for; each spec's first test fails if not.
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));

export type Box = { x: number; y: number; width: number; height: number };
export type Locator = {
  count(): Promise<number>;
  nth(i: number): Locator;
  first(): Locator;
  tap(o?: object): Promise<void>;
  hover(o?: object): Promise<void>;
  boundingBox(): Promise<Box | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
  getAttribute(name: string): Promise<string | null>;
};
export type Page = {
  goto(url: string, o?: object): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  waitForFunction<A>(fn: (a: A) => unknown, a: A, o?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(sel: string): Locator;
  keyboard: { press(key: string): Promise<void> };
  touchscreen: { tap(x: number, y: number): Promise<void> };
};
type CDPSession = { send(method: string, params?: object): Promise<unknown> };
export type Context = { newPage(): Promise<Page>; close(): Promise<void>; newCDPSession(page: Page): Promise<CDPSession> };
export type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
export const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

/**
 * The fixture in `state`, until `close`. In-process, the switches are set
 * rather than left unset: .env.local is a pulled Vercel file carrying
 * VERCEL_ENV=production, and Next loads it into any variable left unset.
 */
export async function serve(state: string, port: number): Promise<{ base: string; close(): void }> {
  if (process.env.E2E_BASE) return { base: process.env.E2E_BASE, close() {} };
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_STATE = state;
  process.env.VERCEL_ENV = "development";
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: ROOT });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server: Server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  return {
    base: `http://127.0.0.1:${port}`,
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** A phone: touch, a mobile viewport and a coarse pointer. */
export async function phone(browser: Browser, width: number, height = 844): Promise<{ ctx: Context; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  return { ctx, page: await ctx.newPage() };
}

/** A desktop window, with a touch screen when `touch` - a touch laptop or a large tablet in landscape. */
export async function desk(browser: Browser, width: number, height = 900, touch = false): Promise<{ ctx: Context; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  return { ctx, page: await ctx.newPage() };
}

/**
 * Loads `url` and waits until React has hydrated every control on it - each
 * carries React's fiber once it has - since a tap before that does nothing.
 * Generous, for a cold server.
 */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button, a[href], summary, input, select, textarea")].every((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))),
    undefined,
    { timeout: 30_000 },
  );
}

/** One finger from `from` to `to`, in ten moves, then lifted. */
export async function slide(ctx: Context, page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let k = 1; k <= 10; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * k) / 10, y: from.y + ((to.y - from.y) * k) / 10 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
}

/** The page is no wider than the window: nothing has pushed it sideways. */
export async function noSideways(page: Page): Promise<{ scrollWidth: number; innerWidth: number }> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
}
