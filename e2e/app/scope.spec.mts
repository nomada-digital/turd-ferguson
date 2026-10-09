/**
 * AG-1 (audit security-2, launch blocker LB2; 9 Oct 2026): per-client member
 * scoping, on TRACKING_FIXTURE_STATE=two-clients - one account with Tallyroo
 * and Ledgerline (fixture-mode.ts). The audit's acceptance: invite a viewer to
 * Tallyroo only; signed in as that viewer, Ledgerline is a 404, the switcher
 * lists Tallyroo only, and Ledgerline's Settings does not list them; an
 * account-wide member still sees both.
 *
 * The fixture session is one member at a time, so the invite and the sign-in
 * are two halves: the owner invites on the writable fixture (writes held in
 * memory, nothing sent), and TRACKING_FIXTURE_ROLE=scoped signs in as the
 * fixture's own Tallyroo-only viewer. repo.ts holds the fixture on globalThis
 * once read; each test sets its state and role and drops it, as
 * e2e/journeys/app-tasks.spec.mts does.
 *
 *   npm run build && node --test e2e/app/scope.spec.mts
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { click(): Promise<void>; count(): Promise<number>; innerText(): Promise<string>; isChecked(): Promise<boolean> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  fill(sel: string, value: string): Promise<void>;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const PORT = Number(process.env.E2E_PORT ?? 3111);
// localhost, as app-tasks.spec.mts: a form's 303 comes back to the host the page is on, which CSP form-action 'self' needs.
const BASE = `http://localhost:${PORT}`;

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_WRITE = "1";
  process.env.VERCEL_ENV = "development";
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: ROOT, hostname: "localhost", port: PORT });
  await app.prepare();
  const handle = app.getRequestHandler();
  server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => server!.listen(PORT, () => resolve()));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
});

/** Serve this fixture state and role from the next request on. */
function as(state: string, role = "owner") {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = role;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
}

async function open(route: string, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

const team = (page: Page) => page.locator("section[aria-labelledby=set-team] ul").innerText();
/** Every dashboard link on the page that names a client's root: the switcher's, and the client's own. */
const clientLinks = (page: Page) =>
  page.evaluate(() => [...new Set([...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => /^\/app\/[^/?#]+$/.test(h)))].sort(), null);

test("an owner invites someone to Tallyroo only, the default, with no script; Ledgerline's Settings does not list them", async () => {
  as("two-clients");
  const { ctx, page } = await open("/app/tallyroo/settings", false);
  await page.locator("#set-invite summary").click();
  assert.equal(await page.locator("#tm-inv-scope-client").isChecked(), true, "this client only is the default");
  assert.match(await page.locator("#set-invite fieldset").innerText(), /Only tallyroo\.com[\s\S]*Every client on this account \(2\)/);
  await page.fill("#tm-inv-email", "marketing@example.com");
  await page.locator("#set-invite button[type=submit]").click();
  await page.waitForURL(/team=invited/, { timeout: 15_000 });
  assert.match(await page.locator("[role=status]").innerText(), /Invited marketing@example\.com\./);
  assert.match(await team(page), /marketing@example\.com\s+Sees only tallyroo\.com/);
  const b = await open("/app/ledgerline/settings");
  assert.equal(b.status, 200);
  assert.doesNotMatch(await team(b.page), /marketing@example\.com|lead@example\.com/, "Ledgerline's team is who sees Ledgerline");
  assert.match(await team(b.page), /books@example\.com\s+Sees only ledgerline\.example/);
  await b.ctx.close();
  await ctx.close();
});

test("signed in as the Tallyroo-only viewer: Ledgerline is a 404 and the switcher lists Tallyroo only", async () => {
  as("two-clients", "scoped");
  for (const route of ["/app/ledgerline", "/app/ledgerline/settings", "/app/ledgerline/clusters"]) {
    const { ctx, status } = await open(route);
    assert.equal(status, 404, route);
    await ctx.close();
  }
  const { ctx, page, status } = await open("/app/tallyroo");
  assert.equal(status, 200);
  assert.deepEqual(await clientLinks(page), ["/app/tallyroo"], "no way to Ledgerline from Tallyroo");
  const s = await open("/app/tallyroo/settings");
  assert.doesNotMatch(await team(s.page), /books@example\.com/, "the Ledgerline-only editor is not on Tallyroo's team");
  assert.doesNotMatch(await team(s.page), /Sees /, "only an owner is told who sees what");
  const home = await open("/app");
  assert.equal(new URL(home.page.url()).pathname, "/app/tallyroo");
  for (const c of [s.ctx, home.ctx, ctx]) await c.close();
});

test("an account-wide member sees both clients", async () => {
  as("two-clients", "viewer");
  const { ctx, page, status } = await open("/app/ledgerline");
  assert.equal(status, 200);
  assert.deepEqual(await clientLinks(page), ["/app/ledgerline", "/app/tallyroo"]);
  await ctx.close();
});

test("a one-client account is as before: no scope lines and no choice on the invite", async () => {
  as("default");
  const { ctx, page } = await open("/app/tallyroo/settings");
  assert.doesNotMatch(await team(page), /Sees /);
  assert.equal(await page.locator("#set-invite fieldset").count(), 0);
  assert.equal(await page.locator("#tm-inv-scope").count(), 0);
  await ctx.close();
});
