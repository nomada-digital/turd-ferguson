/**
 * ON-1 and ON-3 (9 Oct 2026, launch blocker LB8) on the built pages, on the
 * fixture (no login, no database, nothing sent):
 *
 * - a trial bought with no scan checks its keyword on /setup, gets five
 *   prompts drafted from it, edits them and saves them, with no person in
 *   the way - and a refused save says why and marks the field;
 * - a young client's Overview opens on "Since tracking began", every chip
 *   says what it is against, and a range in the URL still wins;
 * - the activation checklist: four steps stated in words, each linked to
 *   where it is done, for a client in its trial or first weeks only, with no
 *   sideways scroll at 390 and nothing serious for axe.
 *
 *   npm run build && E2E_PORT=3305 node --test e2e/app/activation.spec.mts
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { draftPrompts } from "../../src/lib/tracking/add-cluster.ts";
import { checkTime } from "../../src/lib/tracking/check-time.ts";
import { addDays, formatDay } from "../../src/lib/tracking/figures.ts";
import { FIXTURE_ORDER_KEYWORD, YOUNG_DAYS, expandFixture } from "../../src/lib/tracking/fixture-mode.ts";
import { DRAFTS_RESET } from "../../src/lib/tracking/setup-drafts.ts";
import { SLOT_WHY } from "../../src/lib/tracking/slot.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { click(): Promise<void>; count(): Promise<number>; innerText(): Promise<string>; inputValue(): Promise<string>; fill(v: string): Promise<void>; getAttribute(name: string): Promise<string | null>; first(): Locator; nth(i: number): Locator };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  getByRole(role: string, o: { name: string | RegExp }): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3115);
// localhost, as scope.spec.mts: a form's 303 comes back to the host the page is on, which CSP form-action 'self' needs.
const BASE = `http://localhost:${PORT}`;
const fx = expandFixture(JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "tracking", "fixture.json"), "utf8")));
const TOMORROW_AT = checkTime(addDays(fx.today, 1), fx.client.market);

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

/** Serve this fixture state and role from the next request on, with the writes held so far dropped. */
function as(state: string, role = "owner") {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = role;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
}

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

const LIST = "section[aria-labelledby=act-h]";

test("ON-1: a no-scan signup checks its keyword on setup, and saves the five prompts drafted from it", async () => {
  as("signup-typed");
  const { ctx, page } = await open("/app/tallyroo/setup", 1280, false);
  assert.match(await page.locator("#card-c1").innerText(), /Needs a keyword\s+Check a keyword below\. Once it is set, five prompts are drafted from it for you to edit\./);
  assert.doesNotMatch(await page.locator("main, body").first().innerText(), /We write five|We add its Google keyword for you/, "no person promised");
  assert.equal(await page.locator("#setup-kw-0").inputValue(), FIXTURE_ORDER_KEYWORD, "the keyword typed at checkout");
  await page.locator("#card-c1 form[action$='/check'] button[type=submit]").click();
  await page.waitForURL(/ck=ok/, { timeout: 15_000 });
  await page.getByRole("button", { name: `Use “${FIXTURE_ORDER_KEYWORD}” for this cluster` }).click();
  await page.waitForURL(/rekey=rekeyed/, { timeout: 15_000 });
  const drafts = draftPrompts(FIXTURE_ORDER_KEYWORD);
  for (let i = 0; i < drafts.length; i++) assert.equal(await page.locator(`#setup-draft-0-${i}`).inputValue(), drafts[i], `draft ${i}`);
  assert.match(await page.locator("#card-c1").innerText(), new RegExp(`Saved now, they are first asked tomorrow at ${TOMORROW_AT}\\.`));

  // Two the same, with no script: the route refuses with the batch's own words, marks the field it is about, and
  // says the fields came back as drafted (ON-1 review, 9 Oct 2026).
  await page.locator("#setup-draft-0-1").fill(drafts[0]!);
  await page.getByRole("button", { name: "Save these prompts" }).click();
  await page.waitForURL(/drafts=refused&why=twin&at=1/, { timeout: 15_000 });
  assert.equal(await page.locator("#setup-draft-0-note").innerText(), `${SLOT_WHY.twin} ${DRAFTS_RESET}`);
  assert.equal(await page.locator("#setup-draft-0-1").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#setup-draft-0-0").getAttribute("aria-invalid"), null);

  // Edited and saved: the card lists its five, and says when they are first asked.
  const mine = "Which invoicing app do freelance designers rate?";
  await page.locator("#setup-draft-0-4").fill(mine);
  await page.getByRole("button", { name: "Save these prompts" }).click();
  await page.waitForURL(/drafts=saved/, { timeout: 15_000 });
  const card = await page.locator("#card-c1").innerText();
  assert.match(card, new RegExp(`Saved\\. They are first asked tomorrow at ${TOMORROW_AT}\\.`));
  for (const t of [...drafts.slice(0, 4), mine]) assert.ok(card.includes(t), `the card lists "${t}"`);
  assert.equal(await page.locator("#setup-draft-0-0").count(), 0, "no drafts once it has prompts");
  // Step 3 now promises the first check, which it would not with no prompt.
  assert.match(await page.locator("form[action$='/setup']").innerText(), new RegExp(`The first check runs tomorrow at ${TOMORROW_AT}\\.`));

  // Confirmed, the Overview's checklist has setup done and the first check still to come, with its time.
  await page.locator("form[action$='/setup'] button[type=submit]").click();
  await page.waitForURL(/setup=confirmed/, { timeout: 15_000 });
  const steps = await page.locator(`${LIST} li`).count();
  assert.equal(steps, 4);
  assert.equal(await page.locator(`${LIST} li[data-step=setup]`).getAttribute("data-done"), "yes");
  const first = await page.locator(`${LIST} li[data-step=first]`).innerText();
  assert.match(first, /To do/);
  assert.match(first, new RegExp(`The first check runs tomorrow at ${TOMORROW_AT}\\.`));
  await ctx.close();
});

test("ON-1 review: with script, two drafts the same are refused before posting, every edit kept, the field marked", async () => {
  as("signup-typed");
  const { ctx, page } = await open("/app/tallyroo/setup");
  await page.locator("#card-c1 form[action$='/check'] button[type=submit]").click();
  await page.waitForURL(/ck=ok/, { timeout: 15_000 });
  await page.getByRole("button", { name: `Use “${FIXTURE_ORDER_KEYWORD}” for this cluster` }).click();
  await page.waitForURL(/rekey=rekeyed/, { timeout: 15_000 });
  const before = page.url();
  const mine = "Which invoicing app do freelance designers rate?";
  await page.locator("#setup-draft-0-2").fill(mine);
  await page.locator("#setup-draft-0-3").fill(mine);
  await page.getByRole("button", { name: "Save these prompts" }).click();
  assert.equal(page.url(), before, "nothing posted");
  assert.equal(await page.locator("#setup-draft-0-note").innerText(), SLOT_WHY.twin);
  assert.equal(await page.locator("#setup-draft-0-3").getAttribute("aria-invalid"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id ?? ""), "setup-draft-0-3");
  assert.equal(await page.locator("#setup-draft-0-2").inputValue(), mine, "the member's edit is still there");
  // Fixed, it saves.
  await page.locator("#setup-draft-0-3").fill("Which invoicing app suits a freelance photographer?");
  await page.getByRole("button", { name: "Save these prompts" }).click();
  await page.waitForURL(/drafts=saved/, { timeout: 15_000 });
  assert.ok((await page.locator("#card-c1").innerText()).includes(mine));
  await ctx.close();
});

test("ON-3: a young client opens on Since tracking began, every chip says what it is against, and a URL range wins", async () => {
  as("young");
  const start = addDays(fx.today, -YOUNG_DAYS);
  const week = `vs your first week, ${formatDay(start)} - ${formatDay(addDays(start, 6))}`;
  const { ctx, page } = await open("/app/tallyroo");
  const face = await page.locator("#app-content header").first().innerText();
  assert.match(face, /Since tracking began/);
  assert.ok(face.includes(week), `the face names the comparison: ${face}`);
  // Each chip's change is read out with what it is against; once, not as a hover title as well (review, same day).
  const said = await page.evaluate(() => [...document.querySelectorAll("[data-vs]")].map((e) => [e.textContent, e.parentElement?.getAttribute("title") ?? null]));
  assert.ok(said.length >= 5, `${said.length} chips say what they are against`);
  assert.deepEqual([...new Set(said.map(([t]) => t))], [` ${week}`], "one comparison on the page");
  assert.ok(said.every(([, title]) => title === null || !title.includes(week)), "no title repeats it");
  await ctx.close();

  const stated = await open(`/app/tallyroo?from=${addDays(fx.today, -6)}&to=${fx.today}`);
  assert.match(await stated.page.locator("#app-content header").first().innerText(), /Last 7 days/);
  await stated.ctx.close();
  // An older client keeps the last 28 days.
  as("default");
  const older = await open("/app/tallyroo");
  assert.match(await older.page.locator("#app-content header").first().innerText(), /Last 28 days/);
  await older.ctx.close();
});

test("ON-3: the checklist states each step in words and links to where it is done; only for a trial or a young client", async () => {
  as("young");
  for (const width of [1280, 390]) {
    const { ctx, page } = await open("/app/tallyroo", width);
    assert.equal(await page.locator(LIST).count(), 1, `${width}: drawn`);
    assert.match(await page.locator(LIST).innerText(), /Getting started\s+3 of 4 done/);
    const items = await page.evaluate(() => [...document.querySelectorAll("section[aria-labelledby=act-h] li")].map((li) => [li.getAttribute("data-step"), li.getAttribute("data-done"), li.querySelector("a")?.getAttribute("href"), /\b(Done|To do)\b/.exec((li as HTMLElement).innerText)?.[1]]));
    assert.deepEqual(items, [
      ["setup", "yes", "/app/tallyroo/setup", "Done"],
      ["first", "yes", "/app/tallyroo/clusters", "Done"],
      ["invite", "yes", "/app/tallyroo/settings#set-team", "Done"],
      ["report", "no", "/app/tallyroo/reports", "To do"],
    ]);
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(scroll <= inner, `${width}: no sideways scroll (${scroll} > ${inner})`);
    await page.addScriptTag({ content: AXE });
    const found = await page.evaluate(async () => {
      // @ts-expect-error injected
      const r = await window.axe.run(document.querySelector("section[aria-labelledby=act-h]"), { resultTypes: ["violations"] });
      return (r.violations as { id: string; impact: string }[]).filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.impact} ${v.id}`);
    });
    assert.deepEqual(found, [], `${width}: axe`);
    await ctx.close();
  }
  for (const [state, shown] of [["trial", true], ["default", false], ["ended", false]] as const) {
    as(state);
    const { ctx, page } = await open("/app/tallyroo");
    assert.equal(await page.locator(LIST).count(), shown ? 1 : 0, state);
    await ctx.close();
  }
});
