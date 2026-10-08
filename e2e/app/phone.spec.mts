/**
 * The phone layouts of audit mobile-1, 3, 4, 6 and 10 (8 Oct 2026), on the
 * default fixture, which has clusters. Each test is an acceptance line the
 * audit wrote, run at 320 and 390 on a touch phone; the by-cluster grid's
 * labels are checked at 768 and 1024, where they show.
 *
 *   npm run build && node --test e2e/app/phone.spec.mts
 *
 * The by-engine grid and the Overview's by-day chart are drawn only by the
 * ungrouped state, so phone-chart.spec.mts holds those.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { chromium, desk, noSideways, open, phone, serve, type Browser } from "./phone-harness.mts";

const PORT = Number(process.env.E2E_PORT ?? 3109);
const PHONES = [320, 390] as const;
const HOME = "/app/tallyroo";

let browser: Browser;
let base = "";
let stop = () => {};

before(async () => {
  ({ base, close: stop } = await serve("default", PORT));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  stop();
});

test("the server is serving the default fixture, with clusters", async () => {
  const { ctx, page } = await phone(browser, 390);
  await open(page, `${base}${HOME}`);
  const grids = await page.evaluate(() => document.querySelectorAll('[aria-label="Daily checks by cluster"]').length);
  await ctx.close();
  assert.equal(grids, 1, "no by-cluster grid on the Overview - E2E_BASE is serving another fixture state");
});

for (const width of PHONES) {
  describe(`a phone at ${width}`, () => {
    test("mobile-3: the day strip opens on Today, every count beside its engine, and swipes back to the first day", async () => {
      const { ctx, page } = await phone(browser, width);
      await open(page, `${base}${HOME}/clusters/c1`);
      const read = () =>
        page.evaluate(() => {
          const sc = document.getElementById("strip-scroll")!;
          const s = sc.getBoundingClientRect();
          const inside = (r: DOMRect) => r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.right <= innerWidth + 0.5;
          return [...sc.querySelectorAll<HTMLElement>(".app-strip-row")]
            .map((row) => {
              const lab = row.querySelector<HTMLElement>(".app-strip-lab")!;
              const n = row.querySelector<HTMLElement>(".app-strip-n")!;
              const cells = [...row.querySelectorAll<HTMLElement>(".app-strip-cell")];
              const l = lab.getBoundingClientRect();
              const c = n.getBoundingClientRect();
              const first = cells[0]!.getBoundingClientRect();
              const last = cells[cells.length - 1]!.getBoundingClientRect();
              return {
                count: (n.textContent ?? "").trim(),
                sticky: getComputedStyle(lab).position === "sticky" && getComputedStyle(n).position === "sticky",
                labIn: inside(l),
                countIn: inside(c),
                lastShown: last.left >= l.right - 0.5 && last.right <= c.left + 0.5,
                firstShown: first.left >= l.right - 0.5 && first.right <= c.left + 0.5,
              };
            })
            .filter((r) => r.count);
        });
      const atLoad = await read();
      assert.ok(atLoad.length >= 4, `only ${atLoad.length} engine rows in the strip`);
      for (const r of atLoad) {
        assert.match(r.count, /^(\d+ of \d+|-)$/, `a count reads "${r.count}"`);
        assert.ok(r.sticky, `${r.count}: the engine mark or the count is not sticky`);
        assert.ok(r.labIn && r.countIn, `${r.count}: the engine mark or the count is out of view on load`);
        assert.ok(r.lastShown, `${r.count}: the latest day is not in view on load`);
      }
      assert.ok((await noSideways(page)).scrollWidth <= width, "the page scrolls sideways");

      // Swiped all the way back: the first day is in view, and the marks and counts still are.
      await page.evaluate(() => {
        const sc = document.getElementById("strip-scroll")!;
        sc.scrollLeft = -sc.scrollWidth;
      });
      await page.waitForTimeout(100);
      for (const r of await read()) {
        assert.ok(r.labIn && r.countIn, `${r.count}: the engine mark or the count left the view at the first day`);
        assert.ok(r.firstShown, `${r.count}: the first day is not in view after swiping back`);
      }
      await ctx.close();
    });

    for (const [name, url, picks] of [
      ["Who is named", `${HOME}/named?cluster=c8`, ["cluster=c8"]],
      ["Cited pages", `${HOME}/cited?cluster=c8&engine=perplexity`, ["cluster=c8", "engine=perplexity"]],
    ] as const) {
      test(`mobile-4: on ${name} deep-linked to a filter, each row's current chip is in its row`, async () => {
        const { ctx, page } = await phone(browser, width);
        await open(page, `${base}${url}`);
        const read = () =>
          page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>(".app-nm-filters")].map((nav) => {
              const n = nav.getBoundingClientRect();
              const on = [...nav.querySelectorAll<HTMLElement>("[aria-current]")];
              const c = on[0]?.getBoundingClientRect();
              return { label: nav.getAttribute("aria-label"), current: on.length, href: on[0]?.getAttribute("href") ?? "", inside: !!c && c.left >= n.left - 0.5 && c.right <= n.right + 0.5 };
            }),
          );
        // ChipRow scrolls the chip in after hydration.
        await page.waitForFunction(() => [...document.querySelectorAll(".app-nm-filters [aria-current]")].every((c) => {
          const n = c.closest(".app-nm-filters")!.getBoundingClientRect();
          const r = c.getBoundingClientRect();
          return r.left >= n.left - 0.5 && r.right <= n.right + 0.5;
        }), undefined, { timeout: 5_000 }).catch(() => {});
        const rows = await read();
        assert.ok(rows.length >= 2, `only ${rows.length} chip rows`);
        for (const r of rows) {
          assert.equal(r.current, 1, `${r.label}: ${r.current} current chips`);
          assert.ok(r.inside, `${r.label}: the current chip (${r.href}) is outside its row`);
        }
        for (const p of picks) assert.ok(rows.some((r) => r.href.includes(p)), `no current chip is the ${p} the link asked for`);
        await ctx.close();
      });
    }

    test("mobile-6: every field in the dashboard is 16px or more, and the searches are search fields", async () => {
      const { ctx, page } = await phone(browser, width);
      let fields = 0;
      let searches = 0;
      for (const p of ["", "/clusters", "/clusters/c1", "/named", "/cited", "/settings"]) {
        await open(page, `${base}${HOME}${p}`);
        const seen = await page.evaluate(() => {
          const els = [...document.querySelectorAll<HTMLElement>('input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="submit"], [type="button"]), select, textarea')];
          return {
            small: els.map((e) => ({ what: `${e.tagName.toLowerCase()}#${e.id || e.getAttribute("name") || "?"}`, px: parseFloat(getComputedStyle(e).fontSize) })).filter((f) => f.px < 16),
            fields: els.length,
            searches: document.querySelectorAll('input[type="search"][enterkeyhint="search"][autocorrect="off"]').length,
          };
        });
        assert.deepEqual(seen.small, [], `fields under 16px on ${p || "the Overview"}`);
        fields += seen.fields;
        searches += seen.searches;
      }
      // Floors: a selector that stopped matching would report every field fine.
      assert.ok(fields >= 6, `only ${fields} fields found across the pages`);
      assert.ok(searches >= 3, `only ${searches} search fields (Clusters, Who is named, Cited pages)`);
      await ctx.close();
    });

    test("mobile-10: More is current on its pages, closes on a tap outside and on Escape, and stays in reach", async () => {
      const { ctx, page } = await phone(browser, width);
      const summary = () => page.evaluate(() => document.querySelector("details.app-more > summary")?.textContent ?? null);
      const isOpen = () => page.evaluate(() => document.querySelector<HTMLDetailsElement>("details.app-more")!.open);

      await open(page, `${base}${HOME}`);
      assert.doesNotMatch((await summary()) ?? "", /current page/, "More claims the Overview, which is a tab of its own");

      await open(page, `${base}${HOME}/named`);
      assert.match((await summary()) ?? "", /, current page: /, "More does not say Who is named is the current page");
      const more = page.locator("details.app-more > summary");
      await more.tap();
      assert.equal(await isOpen(), true, "a tap on More did not open it");
      const h = (await page.locator("main h1").first().boundingBox())!;
      await page.touchscreen.tap(h.x + 8, h.y + h.height / 2);
      await page.waitForTimeout(100);
      assert.equal(await isOpen(), false, "a tap outside left More open");

      await more.tap();
      assert.equal(await isOpen(), true);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      assert.equal(await isOpen(), false, "Escape left More open");
      assert.equal(await page.evaluate(() => document.activeElement?.closest("details.app-more > summary") !== null), true, "Escape did not return focus to More");

      // The longest page, scrolled to its end: More is still on screen.
      await open(page, `${base}${HOME}/placements`);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const at = await page.evaluate(() => {
        const r = document.querySelector("details.app-more > summary")!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, innerHeight, scrolled: scrollY };
      });
      assert.ok(at.top >= 0 && at.bottom <= at.innerHeight, `More is at ${at.top}-${at.bottom} of ${at.innerHeight} after scrolling ${at.scrolled}px`);
      await ctx.close();
    });

    test("mobile-1: the by-cluster grid fits the card with no labels beside it, and opens on Today", async () => {
      const { ctx, page } = await phone(browser, width);
      await open(page, `${base}${HOME}`);
      const m = await page.evaluate(() => {
        const sc = document.getElementById("ov-heat-scroll")!;
        const s = sc.getBoundingClientRect();
        const g = sc.querySelector("svg")!.getBoundingClientRect();
        return { labels: getComputedStyle(document.querySelector(".app-heat-labels")!).display, gridL: g.left, gridR: g.right, scL: s.left, scR: s.right, overflow: sc.scrollWidth - sc.clientWidth };
      });
      assert.equal(m.labels, "none", "the by-cluster labels show on a phone, where the grid has no room for them");
      assert.ok(m.gridL >= m.scL - 0.5 && m.gridR <= m.scR + 0.5, `the grid (${m.gridL}-${m.gridR}) is not inside the card (${m.scL}-${m.scR})`);
      assert.ok(m.overflow <= 1, `the grid overflows its scroller by ${m.overflow}px`);
      assert.ok((await noSideways(page)).scrollWidth <= width, "the page scrolls sideways");
      await ctx.close();
    });
  });
}

for (const width of [768, 1024] as const) {
  test(`mobile-1: at ${width} each by-cluster label sits level with its row, and the grid opens on Today`, async () => {
    const { ctx, page } = await desk(browser, width);
    await open(page, `${base}${HOME}`);
    const m = await page.evaluate(() => {
      const sc = document.getElementById("ov-heat-scroll")!;
      const s = sc.getBoundingClientRect();
      const svg = sc.querySelector("svg")!;
      const g = svg.getBoundingClientRect();
      // A row is 11px squares 14px apart (Overview.tsx).
      const rows = [...document.querySelectorAll<HTMLElement>(".app-heat-labels > div")].map((l, r) => {
        const b = l.getBoundingClientRect();
        return { label: l.textContent, off: b.top + b.height / 2 - (g.top + r * 14 + 5.5) };
      });
      return { rows, gridR: g.right, scR: s.right };
    });
    assert.ok(m.rows.length >= 3, `only ${m.rows.length} labelled rows`);
    for (const r of m.rows) assert.ok(Math.abs(r.off) <= 1, `${r.label}: ${r.off.toFixed(1)}px off its row`);
    assert.ok(m.gridR <= m.scR + 0.5, `the latest day (${m.gridR}) is past the scroller's edge (${m.scR}) on load`);
    await ctx.close();
  });
}
