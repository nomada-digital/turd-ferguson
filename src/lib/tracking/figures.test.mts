import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AnswerRow,
  basis,
  brandBoard,
  brandGaps,
  brandsRead,
  checkGrid,
  citedPages,
  comparisonRange,
  daysIn,
  keywordRows,
  keywordsOnPage1,
  liveThroughout,
  movers,
  namedRate,
  overview,
  pointsDelta,
  questionsNamed,
  shareOfVoice,
  sparkPoints,
  ungroupedRead,
} from "./figures.ts";

/** T4's figures (docs/tracked-dashboard-2026-09-29/BRIEF.md, 29 Sep 2026). */

const a = (run_date: string, question_id: string, engine: string, named: boolean, brands: string[] = [], answered = true): AnswerRow => ({
  run_date,
  question_id,
  engine,
  answered,
  named,
  brands,
});

test("a rate carries its numerator and denominator, and has no percentage over nothing", () => {
  assert.deepEqual(namedRate([a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false)], { from: "2026-09-01", to: "2026-09-30" }), { num: 1, den: 2, pct: 50 });
  assert.deepEqual(namedRate([], { from: "2026-09-01", to: "2026-09-30" }), { num: 0, den: 0, pct: null });
});

test("DS18: a figure's basis line counts as the page prints counts, with thousands separated", () => {
  assert.equal(basis({ num: 2924, den: 8559 }, "mentions"), "2,924 of 8,559 mentions");
  assert.equal(basis({ num: 0, den: 0 }, "answers"), "0 of 0 answers");
  assert.equal(basis({ num: 12, den: 40 }, "answers"), "12 of 40 answers");
});

test("DS1: ungrouped prompts read in the range are counted - none when all are clustered, all when none are", () => {
  const r = { from: "2026-09-01", to: "2026-09-30" };
  const rows = [a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false), a("2026-09-03", "q3", "gemini", false, [], false), a("2026-08-30", "q4", "chatgpt", true)];
  const clustered = [{ id: "q1", cluster_id: "c1" }, { id: "q2", cluster_id: "c1" }, { id: "q3", cluster_id: "c1" }, { id: "q4", cluster_id: "c1" }];
  assert.equal(ungroupedRead(clustered, rows, r), 0, "clustered");
  const ungrouped = clustered.map((q) => ({ ...q, cluster_id: null }));
  assert.equal(ungroupedRead(ungrouped, rows, r), 2, "q3 unanswered and q4 outside the range are not read");
  const mixed = [clustered[0]!, { id: "q2", cluster_id: null }, { id: "q3", cluster_id: null }, { id: "q4", cluster_id: null }];
  assert.equal(ungroupedRead(mixed, rows, r), 1, "mixed");
  // In the mixed case the headline is overview()'s named rate, over every prompt's answers - Who is named's basis.
  const o = overview({ range: r, compare: "none", startedOn: null, engines: ["chatgpt", "gemini"], questions: [], answers: rows, serp: [], keywordCount: 0 });
  assert.deepEqual([o.named.num, o.named.den], [1, 2]);
});

test("an unanswered read is not in the denominator", () => {
  const r = namedRate([a("2026-09-02", "q1", "gemini", false, [], false), a("2026-09-02", "q1", "chatgpt", true)], { from: "2026-09-02", to: "2026-09-02" });
  assert.deepEqual([r.num, r.den], [1, 1]);
});

test("the previous period is the same length, just before; the month before is one calendar month back", () => {
  assert.deepEqual(comparisonRange({ from: "2026-09-02", to: "2026-09-29" }, "prev"), { from: "2026-08-05", to: "2026-09-01" });
  assert.deepEqual(comparisonRange({ from: "2026-03-31", to: "2026-03-31" }, "month"), { from: "2026-02-28", to: "2026-02-28" });
  assert.equal(comparisonRange({ from: "2026-09-02", to: "2026-09-29" }, "none"), null);
  assert.equal(daysIn({ from: "2026-09-02", to: "2026-09-29" }).length, 28);
});

test("like-for-like counts only questions live all of both periods", () => {
  const range = { from: "2026-09-15", to: "2026-09-28" };
  const qs = [
    { id: "old", added_on: "2026-08-01", stopped_on: null },
    { id: "new", added_on: "2026-09-20", stopped_on: null },
    { id: "gone", added_on: "2026-08-01", stopped_on: "2026-09-22" },
  ];
  const answers = [
    a("2026-09-05", "old", "chatgpt", false),
    a("2026-09-05", "gone", "chatgpt", true),
    a("2026-09-16", "old", "chatgpt", true),
    a("2026-09-21", "new", "chatgpt", true),
    a("2026-09-21", "gone", "chatgpt", false),
  ];
  assert.equal(liveThroughout(qs[0]!, { from: "2026-09-01", to: "2026-09-28" }), true);
  const o = overview({ range, compare: "prev", startedOn: "2026-08-01", engines: ["chatgpt"], questions: qs, answers, serp: [], keywordCount: 0 });
  assert.equal(o.lfl?.questions, 1);
  assert.deepEqual([o.lfl!.now.num, o.lfl!.now.den], [1, 1]);
  assert.deepEqual([o.lfl!.before.num, o.lfl!.before.den], [0, 1]);
  // Overall includes the added and the stopped question, so it differs.
  assert.deepEqual([o.named.num, o.named.den], [2, 3]);
  assert.equal(pointsDelta(o.lfl!.now, o.lfl!.before), 100);
});

test("a comparison reaching before tracking began is hidden, with the line that says so", () => {
  const o = overview({ range: { from: "2026-09-02", to: "2026-09-29" }, compare: "prev", startedOn: "2026-09-10", engines: [], questions: [], answers: [], serp: [], keywordCount: 10 });
  assert.equal(o.compare, null);
  assert.equal(o.lfl, null);
  assert.match(o.compareHidden ?? "", /^Tracking began 10 Sep/);
});

test("questions named, share of voice with rank, keywords on page 1", () => {
  const r = { from: "2026-09-01", to: "2026-09-30" };
  const rows = [a("2026-09-02", "q1", "chatgpt", true, ["Acme"]), a("2026-09-02", "q2", "chatgpt", false, ["Acme", "Bolt"]), a("2026-09-03", "q2", "gemini", false, ["acme"])];
  assert.deepEqual(questionsNamed(rows, r), { num: 1, den: 2, pct: 50 });
  const sov = shareOfVoice(rows, r);
  assert.deepEqual([sov.num, sov.den, sov.rank, sov.brands], [1, 5, 2, 3]);
  const kw = keywordsOnPage1(
    [
      { run_date: "2026-09-01", keyword_id: "k1", position: 14 },
      { run_date: "2026-09-02", keyword_id: "k1", position: 8 },
      { run_date: "2026-09-02", keyword_id: "k2", position: 3 },
      { run_date: "2026-09-02", keyword_id: "k3", position: null },
    ],
    r,
    10,
  );
  assert.deepEqual([kw.num, kw.den, kw.avg], [2, 10, 5.5]);
});

test("movers sort by the size of the change; the brand board counts the client as one brand among them", () => {
  const now = { from: "2026-09-15", to: "2026-09-28" };
  const was = { from: "2026-09-01", to: "2026-09-14" };
  const rows = [
    a("2026-09-02", "up", "chatgpt", false, ["Acme"]),
    a("2026-09-16", "up", "chatgpt", true),
    a("2026-09-02", "flat", "gemini", true),
    a("2026-09-16", "flat", "gemini", true, ["Acme", "Bolt"]),
  ];
  const m = movers(rows, now, was);
  assert.deepEqual(m.map((x) => [x.id, x.delta]), [["up", 100], ["flat", 0]]);
  assert.deepEqual(m[0]!.engines, ["chatgpt"]);
  const board = brandBoard(rows, now, was, "Tally");
  assert.deepEqual(board.map((b) => [b.name, b.you, b.share.num, b.share.den]), [["Tally", true, 2, 4], ["Acme", false, 1, 4], ["Bolt", false, 1, 4]]);
  assert.equal(board[0]!.delta, 0);
});

test("keyword rows: latest position, places gained over the range, one point per day", () => {
  const k = keywordRows(
    [
      { run_date: "2026-09-01", keyword_id: "k", position: 11 },
      { run_date: "2026-09-03", keyword_id: "k", position: 7 },
    ],
    { from: "2026-09-01", to: "2026-09-03" },
  ).get("k")!;
  assert.deepEqual(k, { position: 7, change: 4, series: [11, null, 7] });
});

test("cited pages: counted per page, engines listed, the client's own site marked", () => {
  const pages = citedPages(
    [
      { run_date: "2026-09-02", engine: "chatgpt", citations: [{ source_domain: "www.tallyroo.com", url: "https://www.tallyroo.com/pricing/" }, { source_domain: "ledgerline.com", url: null }] },
      { run_date: "2026-09-02", engine: "gemini", citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/pricing" }] },
    ],
    { from: "2026-09-01", to: "2026-09-30" },
    "tallyroo.com",
  );
  assert.deepEqual(pages, [
    { page: "tallyroo.com/pricing", count: 2, engines: ["chatgpt", "gemini"], yours: true },
    { page: "ledgerline.com", count: 1, engines: ["chatgpt"], yours: false },
  ]);
});

test("the check grid has one cell per engine per day, null where nothing ran", () => {
  const g = checkGrid([a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false)], { from: "2026-09-01", to: "2026-09-02" }, ["chatgpt", "gemini"]);
  assert.deepEqual(g.chatgpt, [null, { num: 1, den: 2, pct: 50 }]);
  assert.deepEqual(g.gemini, [null, null]);
});

test("sparkPoints: one point a week on the keyword's own scale, better positions higher (R104)", () => {
  const days = (ps: (number | null)[]) => ps.flatMap((p) => Array<number | null>(7).fill(p));
  const climb = sparkPoints(days([11, 10, 8, 7]));
  assert.equal(climb.length, 4);
  assert.deepEqual(climb.map((p) => p.x), [2, 22, 42, 62]);
  assert.equal(climb[0]!.y, 18);
  assert.equal(climb[3]!.y, 2);
  assert.ok(climb[1]!.y! > climb[2]!.y!, "a climb slopes up across the cell, not flat");
  assert.ok(sparkPoints(days([3, 3, 3, 3])).every((p) => p.y === 10), "unchanged draws level through the middle");
  assert.equal(sparkPoints(days([5, null, 6, 4]))[1]!.y, null, "a week outside the top 20 is a gap");
});

test("a failed google_aio read (stored answered=false) never counts as not named, and leaves like-for-like unchanged (30 Sep 2026)", () => {
  const questions = [{ id: "q1", added_on: "2026-09-01", stopped_on: null }];
  const base = {
    range: { from: "2026-09-29", to: "2026-09-30" },
    compare: "prev" as const,
    startedOn: "2026-09-01",
    engines: ["google_aio", "chatgpt"],
    questions,
    serp: [],
    keywordCount: 0,
  };
  const good = [
    a("2026-09-27", "q1", "chatgpt", true),
    a("2026-09-28", "q1", "chatgpt", false),
    a("2026-09-29", "q1", "chatgpt", true),
    a("2026-09-30", "q1", "chatgpt", true),
  ];
  // The runner stores a failed read as answered=false, named=false.
  const failed = a("2026-09-30", "q1", "google_aio", false, [], false);
  const clean = overview({ ...base, answers: good });
  const withFail = overview({ ...base, answers: [...good, failed] });
  assert.deepEqual(withFail.named, clean.named, "the failed read is not in the denominator");
  assert.deepEqual(withFail.named, { num: 2, den: 2, pct: 100 });
  assert.deepEqual(withFail.lfl, clean.lfl, "like-for-like reads the same with or without the failed read");
  assert.deepEqual(withFail.grid.google_aio, [null, null], "a day with only a failed read shows no check, not a 0%");
  // Positive control: the same row counted as an answer would have moved the rate.
  const asAnswer = overview({ ...base, answers: [...good, { ...failed, answered: true }] });
  assert.notDeepEqual(asAnswer.named, clean.named);
});

test("8 Oct 2026 (audit reliability-1 / data-6): an answer whose other brands were not read leaves share of voice and the board as they were, not inflated", () => {
  const r = { from: "2026-10-01", to: "2026-10-07" };
  const read = [a("2026-10-01", "q1", "gemini", true, ["Acme", "Bolt"]), a("2026-10-02", "q1", "gemini", false, ["Acme"])];
  // ChatGPT's extraction failed on 2 Oct: whether it named the client is known, the other brands are not.
  const unread: AnswerRow = { ...a("2026-10-02", "q1", "chatgpt", true), brands_ok: false };
  const clean = shareOfVoice(read, r);
  assert.deepEqual([clean.num, clean.den, clean.pct], [1, 4, 25]);
  assert.deepEqual(shareOfVoice([...read, unread], r), clean, "out of numerator and denominator alike");
  assert.deepEqual(brandBoard([...read, unread], r, null, "Tally"), brandBoard(read, r, null, "Tally"));
  // Positive control: stored as it was before 8 Oct - brands [] read as "no other brand" - the share rises.
  const asBefore = shareOfVoice([...read, { ...unread, brands_ok: true }], r);
  assert.deepEqual([asBefore.num, asBefore.den, asBefore.pct], [2, 5, 40]);
  // The named rate still counts it: whether the client was named does not hang on the extraction.
  assert.deepEqual(namedRate([...read, unread], r), { num: 2, den: 3, pct: 67 });
  const out = [{ ...unread, run_date: "2026-09-30" }, { ...unread, engine: "gemini", answered: false }];
  assert.deepEqual(brandGaps([...read, unread, ...out], r), [{ day: "2026-10-02", engine: "chatgpt", answers: 1 }], "answered and in range only");
  assert.equal(brandsRead({}), true, "a row from before the column, or the fixture's, is read");
  assert.equal(brandsRead({ brands_ok: true }), true);
  assert.equal(brandsRead({ brands_ok: false }), false);
});
