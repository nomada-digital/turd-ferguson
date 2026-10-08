import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterChart, clusterDetail, promptBrands, promptStrip } from "./cluster-figures.ts";
import { type Range, addDays, comparisonRange } from "./figures.ts";
import { type Fixture, expandFixture, fixtureState } from "./fixture-mode.ts";
import type { OverviewData } from "./overview-data.ts";
import { chartSeries, citeRows, placementsView } from "./placement-figures.ts";
import { urlKey } from "./placements.ts";
import { ANSWER_SELECT, clusterQuestionIds, monthSlice, reportSpan, shapeRead } from "./read-shape.ts";
import { monthFigures, reportMonths } from "./report-months.ts";

/**
 * The narrow reads (8 Oct 2026, audit perf-4, perf-9, perf-1). Each page on
 * a narrow read is held to draw exactly what it drew on the whole read, on
 * every fixture state with readings: Reports' monthly cards on verdicts only
 * and one month at a time, the one-cluster page on its own prompts, and
 * Placements on its cluster's prompts without brands. The census at the end
 * names the figures those pages draw from their answers, so a new one has to
 * be checked here before it can read a column the page no longer asks for.
 */

const base = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const STATES = ["default", "long", "partial", "failed", "stopped", "uncited", "pilot-mixed", "ungrouped", "new"];
const fixtures: [string, Fixture][] = STATES.map((s) => [s, fixtureState(base, { TRACKING_FIXTURE_STATE: s })]);
const engines = [...new Set(base.data.answers.map((a) => a.engine))];

/** What the Supabase read returns for a range: the fixture holds every day, the database only the ones asked for. */
function within(data: OverviewData, r: Range): OverviewData {
  const keep = (d: string) => d >= r.from && d <= r.to;
  return { ...data, answers: data.answers.filter((a) => keep(a.run_date)), serp: data.serp.filter((s) => keep(s.run_date)) };
}

test("the shapes select what they say, and an emptied column reads as an empty list", () => {
  assert.match(ANSWER_SELECT.full, /\bbrands\b.*\bcitations\b/);
  assert.doesNotMatch(ANSWER_SELECT.cites, /\bbrands\b/);
  assert.match(ANSWER_SELECT.cites, /\bcitations\b/);
  assert.doesNotMatch(ANSWER_SELECT.verdicts, /\bbrands\b|\bcitations\b/);
  for (const cols of Object.values(ANSWER_SELECT)) assert.match(cols, /^run_date, question_id, engine, answered, named\b/);

  const d = base.data;
  assert.deepEqual(shapeRead(d), d, "unshaped is the whole read");
  assert.deepEqual(shapeRead(d, { answers: "none" }).answers, []);
  assert.ok(shapeRead(d, { answers: "verdicts" }).answers.every((a) => a.brands.length === 0 && a.citations.length === 0));
  assert.ok(d.answers.some((a) => a.citations.length > 0), "the fixture cites nothing, so the cites case proves nothing");
  const cites = shapeRead(d, { answers: "cites" }).answers;
  assert.ok(cites.every((a) => a.brands.length === 0));
  assert.deepEqual(
    cites.map((a) => a.citations),
    d.answers.map((a) => a.citations),
  );
  const c1 = shapeRead(d, { cluster: "c1" });
  const ids = new Set(clusterQuestionIds(d.questions, "c1"));
  assert.equal(ids.size, d.questions.filter((q) => q.cluster_id === "c1").length);
  assert.ok(c1.answers.length > 0 && c1.answers.every((a) => ids.has(a.question_id)));
  assert.equal(c1.answers.length, d.answers.filter((a) => ids.has(a.question_id)).length);
  assert.deepEqual(c1.clusters, d.clusters, "every cluster is still read, for the page's N of M");
  assert.deepEqual(shapeRead(d, { cluster: "nope" }).answers, []);
});

test("Reports reads from the oldest month's own comparison, not the whole span's", () => {
  const months = reportMonths("2026-06-10", "2026-09-29");
  const span = reportSpan(months, "2026-09-29");
  assert.deepEqual(span, { from: comparisonRange({ from: "2026-06-01", to: "2026-06-30" }, "prev")!.from, to: "2026-09-29" });
  for (const m of months) assert.ok(comparisonRange(m.range, "prev")!.from >= span.from, `${m.label} reaches before the read`);
  // The old read: the whole span on "prev", as long again before June as June to today.
  const whole = { from: "2026-06-01", to: "2026-09-29" };
  assert.ok(comparisonRange(whole, "prev")!.from < span.from);
  // A year of history read two; it now reads a year and a month (October's 31 days before 1 Oct).
  const year = reportMonths("2025-10-01", "2026-09-29");
  assert.equal(reportSpan(year, "2026-09-29").from, "2025-08-31");
  assert.equal(comparisonRange({ from: "2025-10-01", to: "2026-09-29" }, "prev")!.from, "2024-10-02", "the old read");
});

test("every Reports card is the same on the verdicts-only, month-sliced read, on every fixture state", () => {
  let cards = 0;
  for (const [state, f] of fixtures) {
    const months = reportMonths(f.client.started_on, f.today);
    const span = reportSpan(months, f.today);
    const narrow = within(shapeRead(f.data, { answers: "verdicts" }), span);
    const opts = { startedOn: f.client.started_on, today: f.today, engines };
    for (const m of months) {
      assert.deepEqual(monthFigures(monthSlice(narrow, m.range), m.range, opts), monthFigures(f.data, m.range, opts), `${state} ${m.label}`);
      cards++;
    }
  }
  assert.ok(cards >= 30, `only ${cards} cards compared`);
});

/** The one-cluster page's figures, as clusters/[cluster]/page.tsx and OneCluster.tsx draw them. */
function oneCluster(data: OverviewData, f: Fixture, range: Range, before: Range | null, id: string) {
  const input = { clusters: data.clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today: f.today, engines };
  const detail = clusterDetail(input, id);
  const cards = clusterCards(input);
  const prompts = detail?.card.prompts ?? [];
  return {
    detail,
    index: cards.findIndex((c) => c.id === id) + 1,
    total: cards.length,
    chart: clusterChart(input, id),
    strips: prompts.map((p) => promptStrip({ answers: data.answers, range, engines }, p.id)),
    brands: prompts.map((p) => promptBrands({ answers: data.answers, range }, p.id, f.client.brand)),
  };
}

test("the one-cluster page draws the same from its own prompts' answers as from every cluster's", () => {
  let pages = 0;
  for (const [state, f] of fixtures) {
    const ranges: [Range, "prev" | "month" | "none"][] = [
      [{ from: addDays(f.today, -27), to: f.today }, "prev"],
      [{ from: "2026-08-10", to: "2026-09-20" }, "month"],
      [{ from: "2026-09-01", to: "2026-09-14" }, "none"],
    ];
    for (const [range, compare] of ranges) {
      const before = comparisonRange(range, compare);
      const full = within(f.data, { from: before?.from ?? range.from, to: range.to });
      for (const c of [...f.data.clusters.map((x) => x.id), "not-a-cluster"]) {
        const narrow = within(shapeRead(f.data, { cluster: c }), { from: before?.from ?? range.from, to: range.to });
        assert.deepEqual(oneCluster(narrow, f, range, before, c), oneCluster(full, f, range, before, c), `${state} ${c} ${range.from}`);
        pages++;
      }
    }
  }
  assert.ok(pages >= 150, `only ${pages} pages compared`);
});

/** The placements screen's view, as placements-screen.ts builds it. */
function placements(data: OverviewData, f: Fixture, range: Range, id: string) {
  const clusters = data.clusters.filter((c) => c.stopped_on === null || c.stopped_on > range.from);
  const chart = clusterChart({ clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: null, today: f.today, engines }, id);
  if (!chart) return null;
  const questionIds = data.questions.filter((q) => q.cluster_id === id && (q.stopped_on === null || q.stopped_on > range.from)).map((q) => q.id);
  const rows = f.placements.filter((p) => p.cluster_id === id).map((p) => ({ ...p, url_key: urlKey(p.url) ?? "" }));
  return { view: placementsView({ chart, questionIds, placements: rows, cites: citeRows(data.answers), engines }), series: chartSeries(chart) };
}

test("Placements draws the same from its cluster's prompts, without brands, as from the whole read", () => {
  let screens = 0;
  for (const [state, f] of fixtures) {
    for (const range of [{ from: f.client.started_on, to: f.today }, { from: "2026-09-01", to: f.today }]) {
      for (const c of f.data.clusters.map((x) => x.id)) {
        const narrow = shapeRead(f.data, { answers: "cites", cluster: c });
        assert.deepEqual(placements(narrow, f, range, c), placements(f.data, f, range, c), `${state} ${c} ${range.from}`);
        screens++;
      }
    }
  }
  assert.ok(screens >= 100, `only ${screens} screens compared`);
  assert.ok(base.placements.length > 0, "no placements in the fixture, so the table compared nothing");
});

/**
 * Census, 8 Oct 2026: every use of the answers on a page that reads a narrow
 * shape, each one compared above. A new use fails here until it is compared
 * too - a figure that needs a column the read leaves out would otherwise read
 * it as an empty list, and say zero.
 */
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const USES: [string, string, RegExp, string[]][] = [
  ["the one-cluster page", "../../components/app/OneCluster.tsx", /data\.answers/g, ["answers: data.answers, serp: data.serp, range, before, today, engines", "promptStrip({ answers: data.answers", "promptBrands({ answers: data.answers"]],
  ["the placements screen", "./placements-screen.ts", /data\.answers/g, ["answers: data.answers, serp: data.serp, range, before: null", "cites: citeRows(data.answers)"]],
  ["Reports", "../../app/app/[client]/reports/page.tsx", /(?<![-\w])data\b(?!\.clusters)/g, ["monthFigures(monthSlice(data, m.range)"]],
];

test("census: the pages on a narrow read use their answers only where compared above", () => {
  for (const [what, path, use, lines] of USES) {
    const text = src(path);
    const hits = [...text.matchAll(use)].length;
    for (const l of lines) assert.ok(text.includes(l), `${what}: "${l}" is gone - check its figures above and update this census`);
    // Reports also binds `data` in its destructure; the rest are the uses.
    const expected = what === "Reports" ? lines.length + 1 : lines.length;
    assert.equal(hits, expected, `${what} uses its answers ${hits} times, ${expected} recorded`);
  }
  const reports = src("../../app/app/[client]/reports/page.tsx");
  assert.match(reports, /\{ answers: "verdicts" \}/);
  assert.match(src("./placements-screen.ts"), /\{ answers: "cites", cluster: cluster\.id, structure \}/);
  assert.match(src("../../app/app/[client]/clusters/[cluster]/page.tsx"), /\{ cluster: id \}/);
  for (const p of ["settings", "setup"]) {
    const page = src(`../../app/app/[client]/${p}/page.tsx`);
    assert.doesNotMatch(page, /loadOverview\(/, `${p} reads answers again`);
    assert.match(page, /repo\.structure\(client\.id\)/);
  }
});
