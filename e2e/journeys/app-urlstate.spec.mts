/**
 * R173 pass 9 (2 Oct 2026): the benchmark line "URL holds range, filter, open
 * state", as a spec, from docs/parity/r173-p9-urlstate.mjs. Fixture only, read
 * only: `next start` in-process with TRACKING_FIXTURE=1 on the `long` state.
 *
 *   npm run build && node --test e2e/journeys/app-urlstate.spec.mts
 *
 * Each list page is opened with a stated range and its filters set. Every link
 * and GET form back to the same page must keep the range (from, to, compare),
 * and every link in the page must keep the search. A control may drop only the
 * filter it changes: "All clusters" drops cluster, a new search drops "all",
 * the sidebar's own entry starts the page over but keeps the range (DS38).
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Control = { kind: "a" | "form"; inMain: boolean; label: string; keys: string[] };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const PORT = Number(process.env.E2E_PORT ?? 3110);
const BASE = `http://localhost:${PORT}`;
const RANGE = "from=2026-09-01&to=2026-09-20";

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_STATE = "long";
  process.env.TRACKING_FIXTURE_ROLE = "owner";
  process.env.VERCEL_ENV = "development";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
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

/** The links whose one job is to clear the search: they drop q, as each control drops only the filter it changes. */
const CLEARS = ["Clear the search", "Clear filters"];

/** Placements compares nothing (DS25), so its range is from and to only. */
const CASES: { route: string; range: string[] }[] = [
  { route: `/app/tallyroo/named?${RANGE}&compare=month&engine=chatgpt&cluster=c1&q=book`, range: ["from", "to", "compare"] },
  { route: `/app/tallyroo/cited?${RANGE}&compare=month&engine=chatgpt&cluster=c1&kind=others&q=a`, range: ["from", "to", "compare"] },
  { route: `/app/tallyroo/clusters?${RANGE}&compare=month&q=soft`, range: ["from", "to", "compare"] },
  { route: `/app/tallyroo/placements?${RANGE}&cluster=c1&type=guest_post`, range: ["from", "to"] },
  { route: `/app/tallyroo/clusters/c1?${RANGE}&compare=month&prompt=2&engine=gemini`, range: ["from", "to", "compare"] },
];

for (const width of [1280, 390]) {
  describe(`URL state at ${width}`, () => {
    for (const { route, range } of CASES) {
      test(route.split("?")[0], async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        const r = await page.goto(BASE + route, { waitUntil: "load" });
        assert.equal(r?.status(), 200);
        const start = new URL(page.url());
        assert.equal(start.pathname + start.search, route, "the page keeps its own query");
        const controls = await page.evaluate((pathname) => {
          const out: { kind: "a" | "form"; inMain: boolean; label: string; keys: string[] }[] = [];
          const main = document.querySelector("#app-content");
          const label = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
          for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            const u = new URL(a.href);
            if (u.origin === location.origin && u.pathname === pathname) out.push({ kind: "a", inMain: !!main?.contains(a), label: label(a), keys: [...u.searchParams.keys()] });
          }
          for (const f of document.querySelectorAll<HTMLFormElement>("form")) {
            if ((f.getAttribute("method") || "get").toLowerCase() !== "get" || new URL(f.action || location.href).pathname !== pathname) continue;
            out.push({ kind: "form", inMain: !!main?.contains(f), label: label(f.querySelector("button, [type=submit]") ?? f), keys: [...new FormData(f).keys()] });
          }
          return out;
        }, start.pathname) as Control[];
        assert.ok(controls.length >= 2, `${controls.length} same-page controls - the walk stopped matching`);
        const q = start.searchParams.has("q");
        const lost: string[] = [];
        for (const c of controls) {
          for (const k of range) if (!c.keys.includes(k)) lost.push(`${c.kind} "${c.label}" drops ${k}`);
          // 9 Oct 2026: "Clear the search" and "Clear filters" (264cb40, 8 Oct, audits mobile-4/6) are the
          // controls whose filter is the search, so each must drop q - and still keep the range above.
          const clears = CLEARS.includes(c.label);
          if (q && c.inMain && c.kind === "a" && clears && c.keys.includes("q")) lost.push(`${c.kind} "${c.label}" keeps q`);
          if (q && c.inMain && c.kind === "a" && !clears && !c.keys.includes("q")) lost.push(`${c.kind} "${c.label}" drops q`);
        }
        assert.deepEqual(lost, []);
        await ctx.close();
      });
    }
  });
}
