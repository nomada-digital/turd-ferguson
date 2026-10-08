/**
 * The Overview's by-engine grid (audit mobile-1) and by-day chart (mobile-2),
 * 8 Oct 2026, on the ungrouped fixture - the only state that draws them, as a
 * client with no clusters sees them. Run at 320 and 390 on a touch phone and at
 * 768 on a touch tablet, where the chart is Compact; and on desktop windows,
 * where it is the board, with a mouse and with a touch screen.
 *
 *   npm run build && node --test e2e/app/phone-chart.spec.mts
 *
 * phone.spec.mts holds the layouts the default fixture draws.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { chromium, desk, noSideways, open, phone, serve, slide, type Browser, type Page } from "./phone-harness.mts";

const PORT = Number(process.env.E2E_PORT ?? 3110);
const HOME = "/app/tallyroo";
/** The board readout's width since T4 (chart-board.ts READOUT_W). */
const READOUT_W = 220;

let browser: Browser;
let base = "";
let stop = () => {};

before(async () => {
  ({ base, close: stop } = await serve("ungrouped", PORT));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  stop();
});

/** Which chart is drawn, which lede is shown, and the readout's day and box against the card's. */
function chart(page: Page, which: "sm" | "lg") {
  return page.evaluate((w) => {
    const card = document.querySelector(".app-ovc")!.getBoundingClientRect();
    const out = document.querySelector(`.app-ovc-${w} [role=status]`);
    const r = out?.getBoundingClientRect();
    const shown = (sel: string) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== "none");
    return {
      sm: shown(".app-ovc-sm"),
      lg: shown(".app-ovc-lg"),
      lede: [...document.querySelectorAll(".app-ovc .app-fine, .app-ovc .app-coarse")].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent ?? ""),
      day: out?.firstElementChild?.textContent ?? null,
      width: r?.width ?? 0,
      inCard: !!r && r.left >= card.left - 0.5 && r.right <= card.right + 0.5,
    };
  }, which);
}

/** Each day button's own day, from its label ("29 Sep: 31%, 14 of 45 answers"). */
const dayOf = (label: string | null) => (label ?? "").split(":")[0]!;

/** Gives React its render after a tap, hover or slide: until the readout reads `day`, or two seconds. The assertion after says which. */
async function settle(page: Page, which: "sm" | "lg", day: string): Promise<void> {
  await page
    .waitForFunction(([w, d]) => document.querySelector(`.app-ovc-${w} [role=status]`)?.firstElementChild?.textContent === d, [which, day] as const, { timeout: 2_000 })
    .catch(() => {});
}

test("the server is serving the ungrouped fixture", async () => {
  const { ctx, page } = await phone(browser, 390);
  await open(page, `${base}${HOME}`);
  const seen = await page.evaluate(() => ({ chart: document.querySelectorAll(".app-ovc").length, grid: document.querySelectorAll('[aria-label="Daily checks by engine"]').length }));
  await ctx.close();
  assert.deepEqual(seen, { chart: 1, grid: 1 }, "no by-day chart or by-engine grid on the Overview - E2E_BASE is serving another fixture state");
});

for (const width of [320, 390, 768] as const) {
  describe(`touch at ${width}`, () => {
    test("mobile-1: each engine's mark sits level with its row, and the grid opens on Today", async () => {
      const { ctx, page } = await phone(browser, width, width === 768 ? 1024 : 844);
      await open(page, `${base}${HOME}`);
      const m = await page.evaluate(() => {
        const sc = document.getElementById("ov-heat-scroll")!;
        const s = sc.getBoundingClientRect();
        const g = sc.querySelector("svg")!.getBoundingClientRect();
        // A row is 14px squares 17px apart (Overview.tsx).
        const rows = [...document.querySelectorAll<HTMLElement>("[data-heat-label]")].map((l, r) => {
          const b = l.getBoundingClientRect();
          return { label: l.getAttribute("title"), off: b.top + b.height / 2 - (g.top + r * 17 + 7) };
        });
        return { rows, gridR: g.right, scR: s.right };
      });
      assert.ok(m.rows.length >= 4, `only ${m.rows.length} engine rows`);
      for (const r of m.rows) assert.ok(Math.abs(r.off) <= 1, `${r.label}: ${r.off.toFixed(1)}px off its row`);
      assert.ok(m.gridR <= m.scR + 0.5, `the latest day (${m.gridR}) is past the scroller's edge (${m.scR}) on load`);
      assert.ok((await noSideways(page)).scrollWidth <= width, "the page scrolls sideways");
      await ctx.close();
    });

    test("mobile-2: the chart is Compact, its words 11px, and tapping every day keeps the page and the readout inside", async () => {
      const { ctx, page } = await phone(browser, width, width === 768 ? 1024 : 844);
      await open(page, `${base}${HOME}`);
      const c = await chart(page, "sm");
      assert.ok(c.sm && !c.lg, "the board is drawn on a plot under 880px");
      assert.deepEqual(c.lede, ["Tap a day, or slide along the chart, for the detail."], "the lede does not name the touch gesture");
      const axis = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".app-ovc-sm [data-axis]")].map((e) => parseFloat(getComputedStyle(e).fontSize)));
      assert.ok(axis.length >= 6, `only ${axis.length} axis words`);
      assert.ok(axis.every((px) => px >= 11), `axis words at ${axis.join(", ")}px`);

      const days = page.locator(".app-ovc-sm .app-chart-day");
      const n = await days.count();
      assert.ok(n >= 28, `only ${n} days to tap`);
      for (let i = 0; i < n; i++) {
        const day = days.nth(i);
        const want = dayOf(await day.getAttribute("aria-label"));
        await day.tap();
        await settle(page, "sm", want);
        const after = await chart(page, "sm");
        assert.equal(after.day, want, `day ${i + 1}: the readout reads another day`);
        assert.ok(after.inCard, `day ${i + 1}: the readout is outside the card`);
        const s = await noSideways(page);
        assert.ok(s.scrollWidth <= s.innerWidth, `day ${i + 1}: the page widened to ${s.scrollWidth}`);
      }

      // A slide along the plot picks the day under the finger.
      const from = (await days.nth(2).boundingBox())!;
      const to = (await days.nth(n - 3).boundingBox())!;
      const end = dayOf(await days.nth(n - 3).getAttribute("aria-label"));
      await slide(ctx, page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
      await settle(page, "sm", end);
      assert.equal((await chart(page, "sm")).day, end, "a slide did not pick the day it ended on");
      await ctx.close();
    });
  });
}

test("the board at 1440: hovering every day keeps a 220px readout inside the card", async () => {
  const { ctx, page } = await desk(browser, 1440);
  await open(page, `${base}${HOME}`);
  const c = await chart(page, "lg");
  assert.ok(c.lg && !c.sm, "Compact is drawn on a plot of 880px or more");
  assert.deepEqual(c.lede, ["Hover or tab to a day for the detail."]);
  const days = page.locator(".app-ovc-lg .app-chart-day");
  const n = await days.count();
  assert.ok(n >= 28, `only ${n} days to hover`);
  for (let i = 0; i < n; i++) {
    const day = days.nth(i);
    const want = dayOf(await day.getAttribute("aria-label"));
    await day.hover();
    await settle(page, "lg", want);
    const at = await chart(page, "lg");
    assert.equal(at.day, want, `day ${i + 1}: the readout reads another day`);
    assert.ok(Math.abs(at.width - READOUT_W) <= 0.5, `day ${i + 1}: the readout is ${at.width}px wide`);
    assert.ok(at.inCard, `day ${i + 1}: the readout is outside the card`);
  }
  await ctx.close();
});

for (const [width, height] of [[1280, 900], [1366, 1024]] as const) {
  test(`the board on a touch screen at ${width}: the lede says slide, and a slide picks the day`, async () => {
    const { ctx, page } = await desk(browser, width, height, true);
    await open(page, `${base}${HOME}`);
    const c = await chart(page, "lg");
    assert.ok(c.lg && !c.sm, "Compact is drawn on a plot of 880px or more");
    assert.deepEqual(c.lede, ["Tap a day, or slide along the chart, for the detail."]);
    const days = page.locator(".app-ovc-lg .app-chart-day");
    const n = await days.count();
    await days.nth(2).scrollIntoViewIfNeeded();
    const from = (await days.nth(2).boundingBox())!;
    const to = (await days.nth(n - 3).boundingBox())!;
    const end = dayOf(await days.nth(n - 3).getAttribute("aria-label"));
    // Before: no day is read on the board until one is picked.
    assert.equal(c.day, null, "the board reads a day before one is picked");
    await slide(ctx, page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
    await settle(page, "lg", end);
    const at = await chart(page, "lg");
    assert.equal(at.day, end, "a slide along the board did not pick the day it ended on");
    assert.ok(at.inCard, "the readout is outside the card");
    await ctx.close();
  });
}
