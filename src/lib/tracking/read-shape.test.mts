import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterChart, clusterDetail, promptBrands, promptStrip } from "./cluster-figures.ts";
import { type Range, addDays, comparisonRange } from "./figures.ts";
import { type Fixture, expandFixture, fixtureState } from "./fixture-mode.ts";
import type { OverviewData } from "./overview-data.ts";
import { chartSeries, citeRows, placementsView } from "./placement-figures.ts";
import { urlKey } from "./placements.ts";
import { presets } from "./date-range.ts";
import { PAGE } from "../supabase/page.ts";
import { ANSWER_SELECT, type AnswersQuery, type AnswersTable, type ReadOpts, answerPlan, answerRow, boundStated, clusterQuestionIds, monthSlice, planPrompts, rangeFloor, readAnswers, reportSpan, selectColumns, shapeRead } from "./read-shape.ts";
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

/**
 * Review, 8 Oct 2026: the shaping is one decision (answerPlan, planPrompts)
 * and one read (readAnswers), taken by loadOverview and by the fixture's
 * shapeRead alike. Every equality test in this file runs on shapeRead, so
 * these hold the production read to it: the same function loadOverview calls,
 * on a fake PostgREST that serves the fixture's rows the way the real one
 * does - only the selected columns, only the filtered rows, by id, at most
 * PAGE at a time, with the exact count when asked.
 */
test("the plan: the shape's columns, the cluster's prompts, and no read at all for none", () => {
  assert.deepEqual(answerPlan({}), { select: ANSWER_SELECT.full, cluster: null });
  assert.deepEqual(answerPlan({ answers: "verdicts" }), { select: ANSWER_SELECT.verdicts, cluster: null });
  assert.deepEqual(answerPlan({ answers: "cites", cluster: "c1" }), { select: ANSWER_SELECT.cites, cluster: "c1" });
  assert.equal(answerPlan({ answers: "none" }), null);
  assert.equal(answerPlan({ answers: "none", cluster: "c1" }), null);
  const d = base.data;
  assert.equal(planPrompts(answerPlan({})!, d), null, "every prompt");
  assert.deepEqual(planPrompts(answerPlan({ cluster: "c1" })!, d), clusterQuestionIds(d.questions, "c1"));
  assert.deepEqual(planPrompts(answerPlan({ cluster: "nope" })!, d), [], "a cluster with no prompts reads nothing");
});

test("a column the select left out reads as an empty list, and a stray brand is dropped", () => {
  const row = { run_date: "2026-09-01", question_id: "q1", engine: "chatgpt", answered: true, named: false };
  assert.deepEqual(answerRow(row), { ...row, brands: [], citations: [] });
  assert.deepEqual(answerRow({ ...row, brands: ["Xero", 3, null], citations: null }).brands, ["Xero"]);
  const a = base.data.answers.find((x) => x.brands.length && x.citations.length)!;
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.full)), a);
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.cites)), { ...a, brands: [] });
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.verdicts)), { ...a, brands: [], citations: [] });
});

/** Two reads' rows equal, failing on the count or the first row that differs - a diff of thousands of rows takes a minute. */
function sameRows(got: readonly object[], want: readonly object[], what: string) {
  assert.equal(got.length, want.length, `${what}: row count`);
  const i = got.findIndex((g, k) => JSON.stringify(g) !== JSON.stringify(want[k]));
  if (i >= 0) assert.deepEqual(got[i], want[i], `${what}: row ${i}`);
}

/** A fake PostgREST holding one client's tracking_answers, ids in fixture order. */
function postgrest(rows: readonly object[], clientId: string) {
  const calls: string[][] = [];
  const table: AnswersTable = () => ({
    select(columns, options) {
      const log = [`select ${columns}${options.count ? " (count)" : ""}`];
      calls.push(log);
      const keep: ((r: Record<string, unknown>) => boolean)[] = [];
      let byId = false;
      let [lo, hi] = [0, Number.MAX_SAFE_INTEGER];
      const q: AnswersQuery = {
        eq: (c, v) => (log.push(`eq ${c}`), keep.push(c === "client_domain_id" ? () => v === clientId : (r) => r[c] === v), q),
        gte: (c, v) => (log.push(`gte ${c}`), keep.push((r) => String(r[c]) >= v), q),
        lte: (c, v) => (log.push(`lte ${c}`), keep.push((r) => String(r[c]) <= v), q),
        in: (c, vs) => (log.push(`in ${c}`), keep.push((r) => vs.includes(r[c] as string)), q),
        order: (c) => (log.push(`order ${c}`), (byId = c === "id"), q),
        range: (a, b) => (([lo, hi] = [a, b]), q),
        then: (ok, fail) => {
          const all = rows.map((r, id) => ({ id, ...r })).filter((r) => keep.every((k) => k(r)));
          // Unordered, the planner's order is not the id order: reversed here, so a dropped order shows.
          const ordered = byId ? all : all.reverse();
          const data = ordered.slice(lo, Math.min(hi + 1, lo + PAGE)).map((r) => selectColumns(r, columns));
          return Promise.resolve({ data, error: null, count: options.count ? all.length : null }).then(ok, fail);
        },
      };
      return q;
    },
  });
  return { table, calls };
}

test("readAnswers, loadOverview's own read, returns on PostgREST exactly what shapeRead gives the fixture", async () => {
  let reads = 0;
  for (const state of ["default", "pilot-mixed", "ungrouped"]) {
    const f = fixtures.find(([s]) => s === state)![1];
    const db = postgrest(f.data.answers, f.client.id);
    const where = (r: Range) => ({ clientId: f.client.id, from: r.from, to: r.to });
    const ranges: Range[] = [{ from: addDays(f.today, -55), to: f.today }, { from: "2026-09-01", to: "2026-09-14" }];
    const clusters = [undefined, ...f.data.clusters.slice(0, 2).map((c) => c.id), "nope"];
    for (const answers of [undefined, "full", "cites", "verdicts", "none"] as const) {
      for (const cluster of clusters) {
        for (const r of ranges) {
          const opts: ReadOpts = { answers, cluster };
          const plan = answerPlan(opts);
          const want = within(shapeRead(f.data, opts), r).answers;
          const got = plan === null ? [] : await readAnswers(db.table, plan, planPrompts(plan, f.data), where(r));
          sameRows(got, want, `${state} ${answers ?? "unsaid"} ${cluster ?? "every cluster"} ${r.from}`);
          reads++;
        }
      }
    }
    const other = await readAnswers(db.table, answerPlan({})!, null, { ...where(ranges[0]), clientId: "someone-else" });
    assert.equal(other.length, 0, "another client's id reads none of these rows");
  }
  // 5 shapes x 2 ranges x (every cluster, up to two clusters, none): 40 on default, 30 on pilot-mixed's one cluster, 20 ungrouped.
  assert.ok(reads >= 90, `only ${reads} reads compared`);
});

test("readAnswers asks PostgREST for the plan's columns and, for one cluster, only its prompts", async () => {
  const f = fixtures[0][1];
  const r = { from: addDays(f.today, -55), to: f.today };
  const db = postgrest(f.data.answers, f.client.id);
  const plan = answerPlan({ answers: "cites", cluster: "c1" })!;
  const got = await readAnswers(db.table, plan, planPrompts(plan, f.data), { clientId: f.client.id, from: r.from, to: r.to });
  assert.ok(got.length > 0);
  assert.deepEqual(db.calls[0], [`select ${ANSWER_SELECT.cites} (count)`, "eq client_domain_id", "gte run_date", "lte run_date", "in question_id", "order id"]);
  assert.ok(db.calls.slice(1).every((c) => c[0] === `select ${ANSWER_SELECT.cites}` && c.includes("in question_id")), "a later page lost the filter");
  const all = postgrest(f.data.answers, f.client.id);
  const whole = await readAnswers(all.table, answerPlan({})!, null, { clientId: f.client.id, from: r.from, to: r.to });
  assert.ok(whole.length > PAGE, `${whole.length} rows is one page, so the paging went untested`);
  assert.ok(all.calls.length > 2 && all.calls.every((c) => !c.includes("in question_id")));
  const none = postgrest(f.data.answers, f.client.id);
  assert.deepEqual(await readAnswers(none.table, plan, [], { clientId: f.client.id, from: r.from, to: r.to }), []);
  assert.equal(none.calls.length, 0, "a cluster with no prompts asks for nothing");
});

test("census: loadOverview takes its plan, prompts and read from read-shape.ts, and the fixture repo its shapeRead", () => {
  const data = src("./overview-data.ts");
  const at = data.indexOf("export async function loadOverview(");
  const load = data.slice(at, data.indexOf("\n}\n", at));
  assert.ok(at >= 0 && load.length > 500, "loadOverview not found");
  for (const line of [
    "const plan = answerPlan(opts);",
    "readAnswers(answersTable, p, ids, { clientId, from: earliest, to: range.to })",
    'db.from("tracking_answers")) as unknown as AnswersTable',
    "plan === null ? Promise.resolve([]) : plan.cluster === null ? answersRead(plan, null) : structureP.then((s) => answersRead(plan, planPrompts(plan, s)))",
  ]) {
    assert.ok(load.includes(line), `loadOverview: "${line}" is gone - hold its read to shapeRead again before updating this census`);
  }
  // One copy: the decisions are not taken again beside the plan.
  for (const second of ["ANSWER_SELECT", "clusterQuestionIds"]) assert.ok(!data.includes(second), `overview-data.ts shapes the answers itself again: ${second}`);
  for (const second of ['"question_id"', "brands", "citations"]) assert.ok(!load.includes(second), `loadOverview filters or maps the answers itself again: ${second}`);
  assert.match(src("./repo.ts"), /shapeRead\(fixture\(\)\.data, opts\)/);
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

/**
 * perf-8 (8 Oct 2026): a stated range has a lower bound. On the fixture dev
 * server /app/tallyroo/clusters/c1?from=1900-01-01 rendered 134 MB in 66 s.
 */
test("a stated from before the floor starts on it; one wholly before it is no range", () => {
  const today = "2026-09-29";
  // Review, 8 Oct 2026: the floor is the first of its month, so a Reports month card's range is never cut (below).
  assert.equal(rangeFloor(today, "2026-06-10"), "2025-09-01", "the month a year back, for a client younger than that");
  assert.equal(rangeFloor(today, null), "2025-09-01", "no start yet: the month a year back");
  assert.equal(rangeFloor(today, "2024-03-01"), "2024-03-01", "a client older than a year keeps all of its history");
  assert.equal(rangeFloor(today, "2024-03-17"), "2024-03-01", "from the first of the month tracking began in");
  assert.deepEqual(boundStated({ from: "1900-01-01", to: today }, today, "2026-06-10"), { from: "2025-09-01", to: today });
  assert.deepEqual(boundStated({ from: "1900-01-01", to: today }, today, "2024-03-01"), { from: "2024-03-01", to: today });
  assert.equal(boundStated({ from: "1900-01-01", to: "1900-01-31" }, today, "2026-06-10"), null, "the page takes its default");
  assert.equal(boundStated({ from: "2020-01-01", to: "2025-08-31" }, today, null), null);
  assert.deepEqual(boundStated({ from: "2025-09-01", to: "2025-09-01" }, today, null), { from: "2025-09-01", to: "2025-09-01" }, "the floor itself is a day");
  assert.deepEqual(boundStated({ from: "2025-08-20", to: "2025-09-03" }, today, null), { from: "2025-09-01", to: "2025-09-03" });
});

test("every Reports month card's range, which its CSV links state, passes the floor unmoved", () => {
  // Review, 8 Oct 2026: on the day-exact floor a client started 15 Sep 2025 had its September card's
  // files cut to start on the 15th, and one started 20 Oct 2025 had October's cut to the 8th.
  let cards = 0;
  for (const today of ["2026-10-08", "2026-09-29", "2026-03-31", "2026-01-01", "2028-02-29"]) {
    const ages = [0, 27, 200, 330, 360, 364, 365, 366, 370, 380, 400, 500, 800];
    for (const back of ages) {
      const started = addDays(today, -back);
      for (const m of reportMonths(started, today)) {
        assert.deepEqual(boundStated(m.range, today, started), m.range, `${m.label} for a client started ${started}, today ${today}`);
        cards++;
      }
    }
    for (const started of ["2025-09-15", "2025-10-20", "2024-03-17"]) {
      for (const m of reportMonths(started, today)) assert.deepEqual(boundStated(m.range, today, started), m.range, `${m.label}, started ${started}`);
    }
  }
  assert.ok(cards >= 200, `only ${cards} cards checked`);
});

test("a from before tracking began is honoured inside the year: the default range and its links state one", () => {
  const today = "2026-09-29";
  // Nine days old (the trial): the default 28 days start 19 days before tracking did, and every page's links carry them.
  const young = "2026-09-20";
  const dflt = { from: addDays(today, -27), to: today };
  assert.deepEqual(boundStated(dflt, today, young), dflt);
  assert.deepEqual(boundStated({ from: "2026-06-01", to: today }, today, young), { from: "2026-06-01", to: today });
  // Nothing the picker offers moves, whatever the client's age.
  for (const started of [null, today, young, "2026-06-10", "2025-12-01", "2025-10-20", "2025-09-15", "2024-03-01", "2024-03-17", "2026-10-05"]) {
    for (const p of presets(today, started)) assert.deepEqual(boundStated(p.range, today, started), p.range, `${p.id} for a client started ${started}`);
    assert.deepEqual(boundStated(dflt, today, started), dflt);
  }
});

test("rangeFrom applies the floor, and every page and the CSV route pass it the client's start", () => {
  const data = src("./overview-data.ts");
  assert.match(data, /boundStated\(\{ from, to \}, today, startedOn\)/, "rangeFrom no longer bounds a stated range");
  assert.match(src("../../app/api/app/[client]/report/route.ts"), /rangeFrom\(Object\.fromEntries\(sp\), repo\.today\(\), client\.started_on\)/);
  assert.match(src("./placements-screen.ts"), /rangeFrom\(sp, today, client\.started_on \?\? null\)/);
  let calls = 0;
  for (const p of ["", "/clusters", "/clusters/[cluster]", "/named", "/cited", "/reports"]) {
    const page = src(`../../app/app/[client]${p}/page.tsx`);
    assert.match(page, /rangeFrom\(sp, today, client\.started_on\)/, `${p || "/"} reads its range without the client's start`);
    calls++;
  }
  assert.equal(calls, 6);
});
