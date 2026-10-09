/**
 * DB-2 (9 Oct 2026): every figure and row opens the answers that produced
 * it. "When I click a brand, a cited page or a day's square, I land on the
 * answer that named that brand or cited that page on that day." On the
 * default fixture (today 29 Sep 2026, tracking from 10 Jun, readings from
 * 5 Aug; words kept for today's check only, so an earlier day shows its
 * verdict, pages and brands without them), in a browser at 1280 and 390:
 *
 * - a day-grid square lands on that day's answer from that engine, says so,
 *   and links back to the latest;
 * - a Who is named prompt lands on an answer that names the open brand, a
 *   Cited pages prompt on one that cites the open page, an Overview heat cell
 *   on one of the answers it counts;
 * - a bad, future or pre-tracking day and an unknown engine are ignored, and
 *   a day with no check says so;
 * - `?day=` opens nothing of a client the member may not see.
 *
 * Same harness as scope.spec.mts: `next start` on the build, in-process.
 *
 *   npm run build && node --test e2e/app/evidence.spec.mts
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { click(): Promise<void>; count(): Promise<number>; first(): Locator; last(): Locator; innerText(): Promise<string>; getAttribute(name: string): Promise<string | null>; focus(): Promise<void>; scrollIntoViewIfNeeded(): Promise<void>; boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForFunction<A>(fn: (a: A) => unknown, a: A, o?: object): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  keyboard: { press(key: string): Promise<void> };
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const PORT = Number(process.env.E2E_PORT ?? 3112);
const BASE = `http://localhost:${PORT}`;
const HOME = "/app/tallyroo";

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.VERCEL_ENV = "development";
  as("default");
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

/** Serve this fixture state and role from the next request on, as scope.spec.mts does. */
function as(state: string, role = "owner") {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = role;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
}

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, javaScriptEnabled });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

/** The list under one of the answer's headings ("Pages it cited", "Brands it named"), as text. */
const under = (page: Page, heading: string) =>
  page.evaluate((h: string) => {
    const list = [...document.querySelectorAll("section.app-answer h3")].find((x) => x.textContent === h)?.nextElementSibling;
    return list ? [...list.children].map((c) => c.textContent?.trim()).join("\n") || (list.textContent ?? "") : "";
  }, heading);

/** What the answers panel says once it has landed. */
const panel = (page: Page) =>
  page.evaluate(() => {
    const s = document.querySelector<HTMLElement>("section.app-answer");
    const r = s?.getBoundingClientRect();
    const tab = s?.querySelector('nav[aria-label="Engines"] [aria-current="true"]');
    return {
      id: s?.id ?? null,
      heading: s?.querySelector("#ans-h")?.textContent ?? null,
      text: s?.innerText ?? "",
      tab: tab?.textContent?.trim() ?? null,
      inView: !!r && r.top < innerHeight && r.bottom > 0,
      focused: document.activeElement === s,
      sideways: document.documentElement.scrollWidth - innerWidth,
    };
  });

for (const width of [1280, 390]) {
  test(`at ${width}: a day's square lands on that day's answer from that engine, and links back to the latest`, async () => {
    as("default");
    const { ctx, page } = await open(`${HOME}/clusters/c1?prompt=1`, width);
    const squares = page.locator('#strip-scroll a.app-strip-a[aria-label^="15 Sep 2026, Gemini: "]');
    assert.equal(await squares.count(), 1, "15 Sep's Gemini square is not a link");
    const sq = squares.first();
    const said = (await sq.getAttribute("aria-label"))!;
    assert.match(said, /^15 Sep 2026, Gemini: (named you|didn't name you|no answer)\. Open this answer\.$/, "the day, the engine and the outcome in words");
    const href = (await sq.getAttribute("href"))!;
    assert.match(href, /prompt=1&day=2026-09-15&engine=gemini#answer-gemini$/);
    assert.match(href, /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/, "the range rides along");
    // A tap target on the phone: the square keeps its 22px width, and its ::before takes the tap 44px tall (.app-tap).
    const box = (await sq.boundingBox())!;
    assert.ok(box.width >= (width < 600 ? 21.5 : 8) && box.height >= 28, `the square is ${box.width} by ${box.height}`);
    if (width < 600) assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("a.app-strip-a")!, "::before").height), "44px");
    await sq.scrollIntoViewIfNeeded();
    await sq.click();
    await page.waitForURL(/day=2026-09-15&engine=gemini#answer-gemini$/, { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelector("#ans-h")?.textContent === "Answers on 15 Sep 2026", null, { timeout: 10_000 });
    const p = await panel(page);
    assert.equal(p.id, "answer-gemini");
    assert.equal(p.tab, "Gemini", "the Gemini tab is the one shown");
    assert.match(p.text, /Showing Gemini's answer from the check on 15 Sep 2026\. See the latest answers/);
    assert.match(p.text, /What Gemini said\. 15 Sep 2026/);
    const outcome = said.includes("didn't name you") ? /Doesn’t name Tallyroo/ : said.includes("named you") ? /Names Tallyroo/ : /No answer/;
    assert.match(p.text, outcome, "the verdict is the square's");
    assert.ok(p.inView, "the answer is scrolled into view");
    await page.waitForFunction(() => document.activeElement?.id === "answer-gemini", null, { timeout: 5_000 });
    assert.ok(p.sideways <= 0, `the page scrolls ${p.sideways}px sideways`);
    // The square is marked as the one open, and sits clear of the sticky engine mark and count.
    const picked = await page.evaluate(() => {
      const a = document.querySelector<HTMLElement>('#strip-scroll [aria-current="true"]');
      const row = a?.closest(".app-strip-row");
      const q = a?.getBoundingClientRect();
      const lab = row?.querySelector(".app-strip-lab")?.getBoundingClientRect();
      const n = row?.querySelector(".app-strip-n")?.getBoundingClientRect();
      return { label: a?.getAttribute("aria-label") ?? null, clear: !!q && !!lab && !!n && q.left >= lab.right - 0.5 && q.right <= n.left + 0.5 };
    });
    assert.equal(picked.label, said);
    assert.ok(picked.clear, "the picked square is under the engine mark or the count");
    // Back to the latest.
    await page.locator("section.app-answer p a[href*='#answer-']").click();
    await page.waitForFunction(() => document.querySelector("#ans-h")?.textContent === "Latest answers", null, { timeout: 10_000 });
    assert.doesNotMatch(page.url(), /day=/);
    assert.match(page.url(), /prompt=1/);
    await ctx.close();
  });
}

test("with no script a square is still a link to the day's answer", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}/clusters/c1?prompt=1`, 1280, false);
  await page.locator('#strip-scroll a.app-strip-a[aria-label^="22 Sep 2026, ChatGPT: "]').click();
  await page.waitForURL(/day=2026-09-22&engine=chatgpt#answer-chatgpt$/, { timeout: 15_000 });
  const p = await panel(page);
  assert.equal(p.heading, "Answers on 22 Sep 2026");
  assert.equal(p.tab, "ChatGPT");
  await ctx.close();
});

for (const width of [1280, 390]) {
  test(`at ${width}: a Who is named prompt lands on an answer that names the open brand`, async () => {
    as("default");
    const { ctx, page } = await open(`${HOME}/named?open=ledgerline`, width);
    const link = page.locator("li ul a[href*='/clusters/']").first();
    const href = (await link.getAttribute("href"))!;
    const m = href.match(/day=(\d{4}-\d{2}-\d{2})&engine=([a-z_]+)#answer-([a-z_]+)$/);
    assert.ok(m && m[2] === m[3], `the prompt link carries no day and engine: ${href}`);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL(new RegExp(`day=${m[1]}&engine=${m[2]}`), { timeout: 15_000 });
    await page.waitForFunction(() => /^Answers on /.test(document.querySelector("#ans-h")?.textContent ?? ""), null, { timeout: 10_000 });
    const p = await panel(page);
    assert.equal(p.id, `answer-${m[2]}`);
    const brands = await under(page, "Brands it named");
    assert.ok(brands.split("\n").includes("Ledgerline"), `the answer opened does not name Ledgerline: ${brands}`);
    assert.ok(p.inView && p.sideways <= 0);
    await ctx.close();
  });
}

test("a Cited pages prompt lands on an answer that cites the open page", async () => {
  as("default");
  const list = await open(`${HOME}/cited`);
  const toggle = (await list.page.locator("ol li a[aria-expanded]").first().getAttribute("href"))!;
  const page = new URLSearchParams(toggle.slice(1)).get("open")!;
  await list.ctx.close();
  const { ctx, page: p } = await open(`${HOME}/cited${toggle}`);
  const link = p.locator("li ul a[href*='/clusters/']").first();
  assert.match((await link.getAttribute("href"))!, /day=\d{4}-\d{2}-\d{2}&engine=[a-z_]+#answer-[a-z_]+$/);
  await link.click();
  await p.waitForURL(/day=\d{4}-\d{2}-\d{2}&engine=/, { timeout: 15_000 });
  await p.waitForFunction(() => /^Answers on /.test(document.querySelector("#ans-h")?.textContent ?? ""), null, { timeout: 10_000 });
  const cited = await under(p, "Pages it cited");
  assert.ok(cited.split("\n").includes(page), `the answer opened does not cite ${page}: ${cited}`);
  await ctx.close();
});

test("an Overview heat cell is a keyboard-reachable link to one of the answers it counts", async () => {
  as("default");
  const { ctx, page } = await open(HOME);
  const cell = page.locator("#ov-heat-scroll a.app-heat-a").last();
  const said = (await cell.getAttribute("aria-label"))!;
  assert.match(said, /, 29 Sep 2026: named you in (\d+) of (\d+) answers \(\d+%\)\. Open that day's answers\.$/);
  await cell.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("app-heat-a")), true, "the cell takes focus");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/clusters\/[^?]+\?.*day=2026-09-29&engine=[a-z_]+#answer-/, { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector("#ans-h")?.textContent === "Answers on 29 Sep 2026", null, { timeout: 10_000 });
  const named = Number(said.match(/named you in (\d+) of/)![1]);
  assert.match((await panel(page)).text, named > 0 ? /Names Tallyroo/ : /Doesn’t name Tallyroo/, "a cell that counted a name opens one");
  await ctx.close();
});

test("with script each grid of day links is one tab stop, and the arrow keys move between days and rows", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}/clusters/c1?prompt=1&day=2026-09-22&engine=gemini`);
  const stops = (sel: string) => page.evaluate((s: string) => [...document.querySelectorAll(s)].filter((a) => a.getAttribute("tabindex") !== "-1").map((a) => a.getAttribute("aria-label")), sel);
  await page.waitForFunction(() => document.querySelectorAll('#strip-scroll a.app-strip-a[tabindex="-1"]').length > 100, null, { timeout: 5_000 });
  const only = await stops("#strip-scroll a.app-strip-a");
  assert.equal(only.length, 1, `${only.length} tab stops in the day grid`);
  assert.match(only[0]!, /^22 Sep 2026, Gemini: /, "the stop is the open day");
  await page.locator('#strip-scroll a.app-strip-a[aria-current="true"]').focus();
  const label = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  await page.keyboard.press("ArrowLeft");
  assert.match(await label(), /^21 Sep 2026, Gemini: /);
  await page.keyboard.press("ArrowDown");
  assert.match(await label(), /^21 Sep 2026, Perplexity: /);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  assert.match(await label(), /^21 Sep 2026, ChatGPT: /);
  await page.keyboard.press("End");
  assert.match(await label(), /^29 Sep 2026, ChatGPT: /);
  await page.keyboard.press("Enter");
  await page.waitForURL(/day=2026-09-29&engine=chatgpt#answer-chatgpt$/, { timeout: 15_000 });
  await ctx.close();
  // The Overview's heat map: one stop for 280 days, entered on the latest day of the first row.
  const o = await open(HOME);
  await o.page.waitForFunction(() => document.querySelectorAll('#ov-heat-scroll a.app-heat-a[tabindex="-1"]').length > 200, null, { timeout: 5_000 });
  const heat = await o.page.evaluate(() => [...document.querySelectorAll("#ov-heat-scroll a.app-heat-a")].filter((a) => a.getAttribute("tabindex") !== "-1").map((a) => a.getAttribute("aria-label") ?? ""));
  assert.equal(heat.length, 1, `${heat.length} tab stops in the heat map`);
  assert.match(heat[0]!, /, 29 Sep 2026: /);
  await o.ctx.close();
});

test("a bad, future or pre-tracking day and an unknown engine are ignored; a day with no check says so", async () => {
  as("default");
  for (const q of ["day=2026-02-31&engine=claude", "day=2026-10-01", "day=2026-06-09", "day=yesterday", "day=2026-09-22&day=2026-09-23"]) {
    const { ctx, page, status } = await open(`${HOME}/clusters/c1?${q}`);
    assert.equal(status, 200, q);
    assert.equal((await panel(page)).heading, "Latest answers", q);
    await ctx.close();
  }
  const { ctx, page, status } = await open(`${HOME}/clusters/c1?day=2026-07-01&engine=perplexity`);
  assert.equal(status, 200);
  const p = await panel(page);
  assert.equal(p.heading, "Answers on 1 Jul 2026");
  assert.match(p.text, /No check of this prompt is stored for 1 Jul 2026, so there is no answer from that day\. See the latest answers/);
  await ctx.close();
});

test("?day= opens nothing of a client the member may not see", async () => {
  as("two-clients", "scoped");
  for (const route of ["/app/ledgerline/clusters/c1?day=2026-09-22&engine=gemini", "/app/ledgerline/clusters/c1?prompt=0&day=2026-09-29"]) {
    const { ctx, status } = await open(route);
    assert.equal(status, 404, route);
    await ctx.close();
  }
  const { ctx, status } = await open(`${HOME}/clusters/c1?day=2026-09-22&engine=gemini`);
  assert.equal(status, 200, "their own client's day opens");
  await ctx.close();
  as("default");
});
