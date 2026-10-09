/**
 * M1 (8 Oct 2026): the dashboard on its own host. The other e2e/app specs run
 * with APP_HOST unset, which is production today; this one runs the same
 * fixture with APP_HOST=app.localhost:<port>, which is production after
 * Danny's D1 and D2. Chromium resolves *.localhost to the loopback, so the
 * two hosts are one server told apart by the Host header, as on Vercel.
 *
 * Not here: frame-ancestors 'none'. next.config.ts reads APP_HOST at build,
 * so it is checked against a build made with APP_HOST set, not this one.
 */
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Response = { status(): number; headers(): Record<string, string> } | null;
type Page = {
  goto(url: string, o?: object): Promise<Response>;
  url(): string;
  click(sel: string): Promise<void>;
  waitForURL(url: string | RegExp | ((u: URL) => boolean), o?: object): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  $$eval<R>(sel: string, fn: (els: Element[]) => R): Promise<R>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const PORT = Number(process.env.E2E_HOST_PORT ?? 3108);
const APP = `http://app.localhost:${PORT}`;
const MAIN = `http://localhost:${PORT}`;

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_STATE = "long";
  // Writable in memory, so Stop and Undo answer as they would live.
  process.env.TRACKING_FIXTURE_WRITE = "1";
  process.env.VERCEL_ENV = "development";
  process.env.APP_HOST = `app.localhost:${PORT}`;
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: ROOT });
  await app.prepare();
  const handle = app.getRequestHandler();
  server = createServer((req, res) => handle(req, res));
  // Every interface, so app.localhost reaches it whichever loopback Chromium picks.
  await new Promise<void>((resolve) => server!.listen(PORT, () => resolve()));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
});

async function open(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test("the dashboard is served at the app host's root, with no /app in any path", async () => {
  const { ctx, page } = await open();
  const res = await page.goto(`${APP}/tallyroo`, { waitUntil: "networkidle" });
  assert.equal(res?.status(), 200);
  assert.equal(new URL(page.url()).host, `app.localhost:${PORT}`);
  assert.equal(new URL(page.url()).pathname, "/tallyroo");
  assert.equal(res?.headers()["x-robots-tag"], "noindex, nofollow");
  const hrefs = await page.$$eval("nav a[href^='/']", (as) => as.map((a) => a.getAttribute("href") ?? ""));
  assert.ok(hrefs.length > 0, "no dashboard nav links found");
  assert.deepEqual(hrefs.filter((h) => h === "/app" || h.startsWith("/app/")), [], "a nav link still carries /app");
  await ctx.close();
});

test("the marketing header and footer are not shown over the dashboard", async () => {
  for (const width of [1280, 390]) {
    const { ctx, page } = await open(width);
    await page.goto(`${APP}/tallyroo`, { waitUntil: "networkidle" });
    const shown = await page.evaluate(() => [...document.querySelectorAll(".site-chrome")].filter((el) => (el as HTMLElement).getClientRects().length > 0 || getComputedStyle(el).display !== "none").length);
    assert.equal(shown, 0, `site chrome visible at ${width}`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(scroll <= 0, `sideways scroll of ${scroll}px at ${width}`);
    await ctx.close();
  }
});

/**
 * Audit ia-2 (8 Oct 2026): the first test above only held nav links to "no
 * /app prefix", never to resolving. The plan card's "Add 5 clusters" and
 * Clusters' "Get cited" were relative marketing paths, which the proxy rewrote
 * into the dashboard's 404. This follows every link a dashboard page draws -
 * shown, or inside a closed menu - and fails on any that does not answer.
 */
test("no dashboard link 404s on the app host", async () => {
  const pages = ["/tallyroo", "/tallyroo/clusters", "/tallyroo/clusters?add=1", "/tallyroo/clusters/c1", "/tallyroo/placements", "/tallyroo/named", "/tallyroo/cited", "/tallyroo/reports", "/tallyroo/settings"];
  const found = new Map<string, string>();
  for (const width of [1280, 390]) {
    const { ctx, page } = await open(width);
    for (const p of pages) {
      const res = await page.goto(`${APP}${p}`, { waitUntil: "networkidle" });
      assert.equal(res?.status(), 200, `${p} at ${width}`);
      // DB-2 (9 Oct 2026): the Overview's heat cells are SVG links, whose .href is an SVGAnimatedString, not a URL, so
      // every link is resolved from its attribute as the browser resolves it - the heat cells are followed too.
      const links = await page.$$eval("a[href]", (as) => as.filter((a) => a.getClientRects().length > 0 || a.closest("details") !== null).map((a) => [new URL(a.getAttribute("href")!, document.baseURI).href, `${a.getAttribute("href")} "${(a.textContent ?? "").trim().slice(0, 40)}"`]));
      for (const [href, what] of links) if (!found.has(href)) found.set(href, `${what} on ${p} at ${width}`);
    }
    await ctx.close();
  }
  const local = [...found].filter(([href]) => {
    const u = new URL(href);
    return /^https?:$/.test(u.protocol) && (u.host === `app.localhost:${PORT}` || u.host === `localhost:${PORT}`) && !u.pathname.startsWith("/api/");
  });
  // Floors: a page that drew nothing would pass with no links followed.
  assert.ok(local.length >= 40, `only ${local.length} links followed`);
  assert.ok(local.some(([href]) => new URL(href).host === `localhost:${PORT}`), "no link reached the marketing site, so none was checked");
  const broken: string[] = [];
  for (const [href, what] of local) {
    const r = await fetch(href, { redirect: "follow" });
    if (r.status >= 400) broken.push(`${r.status} ${href} - ${what}`);
  }
  assert.deepEqual(broken, []);
});

test("moving between pages keeps the app host and the unprefixed path", async () => {
  const { ctx, page } = await open();
  await page.goto(`${APP}/tallyroo`, { waitUntil: "networkidle" });
  await page.click("nav a[href^='/tallyroo/clusters']");
  await page.waitForURL((u) => u.pathname === "/tallyroo/clusters");
  assert.equal(new URL(page.url()).host, `app.localhost:${PORT}`);
  await ctx.close();
});

test("an old /app address on the main host lands on the app host, path and query intact", async () => {
  const { ctx, page } = await open();
  await page.goto(`${MAIN}/app/tallyroo/clusters?from=2026-09-01&to=2026-09-28`, { waitUntil: "networkidle" });
  const u = new URL(page.url());
  assert.equal(u.host, `app.localhost:${PORT}`);
  assert.equal(u.pathname, "/tallyroo/clusters");
  assert.equal(u.search, "?from=2026-09-01&to=2026-09-28");
  await ctx.close();
});

test("an old /app address on the app host itself drops the prefix", async () => {
  const { ctx, page } = await open();
  await page.goto(`${APP}/app/tallyroo/settings`, { waitUntil: "networkidle" });
  assert.equal(new URL(page.url()).pathname, "/tallyroo/settings");
  await ctx.close();
});

test("a signed-out bookmark goes to the app host's login and keeps its page", async () => {
  process.env.TRACKING_FIXTURE_SESSION = "none";
  try {
    const { ctx, page } = await open();
    await page.goto(`${APP}/tallyroo/clusters`, { waitUntil: "networkidle" });
    const u = new URL(page.url());
    assert.equal(u.host, `app.localhost:${PORT}`);
    assert.equal(u.pathname, "/login");
    assert.equal(u.searchParams.get("next"), "/tallyroo/clusters");
    await ctx.close();
  } finally {
    delete process.env.TRACKING_FIXTURE_SESSION;
  }
});

test("the app host is closed to crawlers and has no /admin", async () => {
  const robots = await fetch(`${APP}/robots.txt`);
  const body = await robots.text();
  assert.equal(robots.status, 200);
  assert.match(body, /User-Agent: \*\nDisallow: \/\n/);
  assert.doesNotMatch(body, /Allow: \//);
  assert.equal((await fetch(`${APP}/admin`, { redirect: "manual" })).status, 404);
  // The main host keeps both: its own robots.txt, and Basic auth on /admin.
  assert.match(await (await fetch(`${MAIN}/robots.txt`)).text(), /Allow: \//);
  // Through node:http, not fetch: fetch sends Sec-Fetch-Mode: cors, which the
  // proxy rightly reads as a prefetch and answers 404 (R162).
  const status = await new Promise<number>((resolve, reject) => {
    request(`${MAIN}/admin`, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject).end();
  });
  assert.ok(status === 401 || status === 503, `main host /admin answered ${status}, not Basic auth (401, or 503 with no credentials)`);
});

/** A form post as a browser without script makes it: the dashboard's Host, no fetch headers. */
function post(path: string, body = ""): Promise<{ status: number; location: string }> {
  return new Promise((resolve, reject) => {
    const r = request(`${MAIN}${path}`, { method: "POST", headers: { host: `app.localhost:${PORT}`, "content-type": "application/x-www-form-urlencoded" } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? "") });
    });
    r.on("error", reject);
    r.end(body);
  });
}

// Audit interactions-1 (8 Oct 2026): every 303 went to the host the server listened on, which the CSP refused.
test("form posts on the app host answer on the app host: stop, undo, login, logout", async () => {
  for (const [path, body, want] of [
    ["/api/app/tallyroo/stop?kind=prompt&id=q2-1", "", /^\/tallyroo\/clusters\?/],
    ["/api/app/tallyroo/stop?kind=prompt&id=q2-1&undo=1", "", /^\/tallyroo\/clusters\?/],
    ["/api/app/login", new URLSearchParams({ email: "owner@example.com" }).toString(), /^\/login\?/],
    ["/api/app/logout", "", /^\/login\?out=/],
  ] as const) {
    const r = await post(path, body);
    assert.equal(r.status, 303, path);
    const to = new URL(r.location, APP);
    assert.equal(to.host, `app.localhost:${PORT}`, `${path} redirected to ${r.location}`);
    assert.match(to.pathname + to.search, want, path);
  }
});

test("Stop on the app host, clicked in Chromium, lands back with its toast and no CSP refusal", async () => {
  const { ctx, page } = await open();
  const refused: string[] = [];
  (page as unknown as { on(e: "console", f: (m: { text(): string }) => void): void }).on("console", (m) => { if (/Content Security Policy/.test(m.text())) refused.push(m.text()); });
  await page.goto(`${APP}/tallyroo/clusters?open=c2`, { waitUntil: "networkidle" });
  await page.click("form[action*='/stop'] button[type=submit]");
  await page.waitForURL((u) => u.searchParams.has("done"));
  const u = new URL(page.url());
  assert.equal(u.host, `app.localhost:${PORT}`);
  assert.equal(u.pathname, "/tallyroo/clusters");
  assert.deepEqual(refused, []);
  await ctx.close();
});
