import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { failureSummary } from "./decide.ts";
import { addDays } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { MISSING_READS, brandGapNote, failedReadNames, failedTodayAside, failedTodayLine, failedTodayNote, latestAnswersNote, lostReads, partialRunNote, runLostReads, runNote, storedAnswers, todayRun } from "./run-note.ts";

/** R151 (1 Oct 2026): the note a screen shows when the last check shown lost reads. */

const range = { from: "2026-09-02", to: "2026-09-29" };
const run = (run_date: string, status: string) => ({ run_date, status, finished_at: `${run_date}T06:10:00Z` });

test("a partial run in the range is named, today's as today's", () => {
  assert.equal(partialRunNote(run("2026-09-29", "partial"), range, "2026-09-29"), `Today's check was partial. ${MISSING_READS}`);
  assert.match(partialRunNote(run("2026-09-20", "partial"), range, "2026-09-29")!, /^The check on 20 Sep was partial\. /);
});

test("no note for a complete run, no run, or a partial run outside the range", () => {
  assert.equal(partialRunNote(run("2026-09-29", "complete"), range, "2026-09-29"), null);
  assert.equal(partialRunNote(null, range, "2026-09-29"), null);
  assert.equal(partialRunNote(run("2026-08-30", "partial"), range, "2026-09-29"), null);
});

test("Overview, Clusters, a cluster, Who is named and Cited pages all take the sentence from run-note.ts", () => {
  // OneCluster added 1 Oct 2026 (R151): the one-cluster page said nothing of a partial run beyond its answer tab.
  // Reports added 8 Oct 2026 (audit reliability-3): it said nothing of a partial or failed check at all.
  for (const f of ["Overview", "Clusters", "OneCluster", "Named", "Cited", "Reports"]) {
    const src = readFileSync(new URL(`../../components/app/${f}.tsx`, import.meta.url), "utf8");
    if (f !== "Reports") assert.match(src, /from "@\/lib\/tracking\/run-note"/, `${f} imports run-note`);
    assert.ok(!src.includes("did not come back") && !src.includes("check failed"), `${f} has no copy of the sentences`);
  }
  // 8 Oct 2026 (audit data-3): every page reads the range's runs, not only the last one.
  for (const f of ["Clusters", "OneCluster", "Named", "Cited"]) {
    const src = readFileSync(new URL(`../../components/app/${f}.tsx`, import.meta.url), "utf8");
    // Merge of audit packages B and C (8 Oct 2026): the one-cluster page, on its own prompts' answers (perf-9),
    // also says which days they were asked, so its note claims nothing those answers cannot show.
    assert.match(src, f === "OneCluster" ? /runNote\(data, range, today, \{ askedOn \}\)/ : /runNote\(data, range, today\)/, `${f} notes every lost check in its range`);
    assert.ok(!src.includes("partialRunNote("), `${f} still reads the last run only`);
  }
  const reports = readFileSync(new URL("../../app/app/[client]/reports/page.tsx", import.meta.url), "utf8");
  assert.match(reports, /note=\{runNote\(data, range, today\)\}/, "Reports is handed the range's note");
});

const today = "2026-09-29";
const runs = (...xs: [string, string, string?][]) => xs.map(([run_date, status, error]) => ({ run_date, status, error: error ?? null }));

test("8 Oct 2026 (audit data-3): the engines a run's error line names, never its reasons", () => {
  assert.deepEqual(failedReadNames("4 of 21 reads failed - google_aio: 4 x HTTP 429"), ["Google AI Overviews"]);
  assert.deepEqual(failedReadNames("6 of 21 reads failed - google_aio: 4 x HTTP 429; chatgpt: 1 x timeout; keyword: 1 x empty SERP: no organic results came back"), ["Google AI Overviews", "ChatGPT", "Google keyword positions"]);
  assert.deepEqual(failedReadNames("2 of 21 reads failed - google_aio: 1 x HTTP 500; google_aio: 1 x timeout"), ["Google AI Overviews"], "each engine once");
  assert.deepEqual(failedReadNames("the run was stopped before it could record a result"), [], "a line with no engine names none");
  assert.deepEqual(failedReadNames(null), []);
  assert.deepEqual(failedReadNames("1 of 2 reads failed - bing: 1 x HTTP 500"), [], "an engine this file does not know is left out");
});

test("8 Oct 2026 (audit data-3): one lost check in the range is named with what it lost; several are listed; none is no note", () => {
  const data = (rs: ReturnType<typeof runs>) => ({ lastRun: null, runs: rs });
  assert.equal(runNote(data(runs([today, "partial", "45 of 225 reads failed - google_aio: 45 x HTTP 500"], ["2026-09-28", "complete"])), range, today), `Today's check was partial (Google AI Overviews). ${MISSING_READS}`);
  assert.equal(runNote(data(runs(["2026-09-20", "partial"])), range, today), `The check on 20 Sep was partial. ${MISSING_READS}`);
  assert.equal(runNote(data(runs([today, "failed"])), range, today), "Today's check failed: none of its reads came back, so they are left out of the figures, not counted as misses.");
  assert.equal(runNote(data(runs([today, "partial"], ["2026-09-20", "failed"], ["2026-09-10", "partial"])), range, today), `3 checks in this range lost reads: 10 Sep (partial), 20 Sep (failed) and today (partial). ${MISSING_READS}`);
  assert.equal(
    runNote(data(runs([today, "partial", "4 of 21 reads failed - google_aio: 4 x HTTP 429"], ["2026-09-20", "partial", "2 of 21 reads failed - perplexity: 1 x timeout; google_aio: 1 x HTTP 500"])), range, today),
    `2 checks in this range lost reads (Perplexity and Google AI Overviews): 20 Sep (partial) and today (partial). ${MISSING_READS}`,
  );
  const many = runs(...["03", "05", "07", "09", "11", "13"].map((d): [string, string] => [`2026-09-${d}`, "partial"]));
  assert.match(runNote(data(many), range, today)!, /^6 checks in this range lost reads: 7 Sep \(partial\), 9 Sep \(partial\), 11 Sep \(partial\), 13 Sep \(partial\) and 2 earlier\. /);
  assert.equal(runNote(data(runs([today, "complete"], ["2026-08-30", "partial"], [today, "running"])), range, today), null, "complete, outside the range, or still going");
  // The Overview's own line says what today's check did, so its note leaves today out.
  assert.equal(runNote(data(runs([today, "failed"])), range, today, { skipToday: true }), null);
  assert.equal(runNote(data(runs([today, "failed"], ["2026-09-20", "partial"])), range, today, { skipToday: true }), `The check on 20 Sep was partial. ${MISSING_READS}`);
  // Without run rows (the parity fixture) it is the last-run note it replaced.
  assert.equal(runNote({ lastRun: run(today, "partial") }, range, today), partialRunNote(run(today, "partial"), range, today));
});

test("8 Oct 2026 (audit data-3): today's run of any status, and the lines a failed one gets", () => {
  assert.equal(todayRun(runs([today, "failed"], ["2026-09-28", "complete"]), today)?.status, "failed");
  assert.equal(todayRun(runs(["2026-09-28", "complete"]), today), null);
  assert.equal(failedTodayLine("2026-09-28"), "Today's check failed, so the figures run to 28 Sep.");
  assert.equal(latestAnswersNote(runs([today, "failed"]), "2026-09-28", range, today), "Today's check failed, so these are the answers from 28 Sep.");
  assert.equal(latestAnswersNote(runs([today, "partial"]), "2026-09-28", range, today), null, "a partial check still answered");
  assert.equal(latestAnswersNote(runs([today, "failed"]), today, range, today), null);
});

test("8 Oct 2026 (audit data-3 / reliability-3): the failed and partial fixture states carry the notes every page shows", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const r = { from: addDays(fx.today, -27), to: fx.today };
  assert.equal(runNote(fx.data, r, fx.today), null, "the default state lost nothing");
  const failed = fixtureState(fx, { TRACKING_FIXTURE_STATE: "failed" }).data;
  assert.match(runNote(failed, r, fx.today)!, /^Today's check failed: /);
  assert.equal(failedTodayLine(failed.lastRun!.run_date), "Today's check failed, so the figures run to 28 Sep.");
  const partial = fixtureState(fx, { TRACKING_FIXTURE_STATE: "partial" }).data;
  assert.equal(runNote(partial, r, fx.today), `2 checks in this range lost reads (Google AI Overviews): 20 Sep (partial) and today (partial). ${MISSING_READS}`);
  assert.equal(runNote(partial, r, fx.today, { skipToday: true }), `The check on 20 Sep was partial (Google AI Overviews). ${MISSING_READS}`);
});

test("8 Oct 2026 (audit data-3): Latest answers picks the latest day with an answer, in Supabase and on the fixture", () => {
  const loader = readFileSync(new URL("./overview-data.ts", import.meta.url), "utf8");
  const pick = loader.slice(loader.indexOf("export async function loadLatestAnswers"), loader.indexOf(".limit(1);", loader.indexOf("export async function loadLatestAnswers")));
  assert.match(pick, /\.eq\("answered", true\)/, "a failed run's unanswered rows are not the latest check");
  const repo = readFileSync(new URL("./repo.ts", import.meta.url), "utf8");
  assert.match(repo, /a\.answered && \(d === null \|\| a\.run_date > d\)/, "the fixture picks the same day");
});

test("8 Oct 2026 (review of audit data-3): on a range that ends before today, a failed check today claims nothing about the range", () => {
  // The Overview on 5 Aug - 1 Sep read "Today's check failed, so the figures run to 28 Sep" - a day the page does not show.
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const failed = fixtureState(fx, { TRACKING_FIXTURE_STATE: "failed" }).data;
  assert.deepEqual(failedTodayNote(failed, { from: addDays(fx.today, -27), to: fx.today }, fx.today), { line: "Today's check failed, so the figures run to 28 Sep.", aside: null });
  assert.deepEqual(failedTodayNote(failed, { from: "2026-08-05", to: "2026-09-01" }, fx.today), { line: null, aside: "Today's check failed." });
  assert.equal(failedTodayNote(fx.data, { from: addDays(fx.today, -27), to: fx.today }, fx.today), null, "today's check did not fail");
  const src = readFileSync(new URL("../../components/app/Overview.tsx", import.meta.url), "utf8");
  assert.match(src, /const failed = failedTodayNote\(data, range, today\);/);
  assert.match(src, /failed\?\.aside \? `\$\{failed\.aside\} Next check tomorrow at 06:00\.`/, "an earlier range keeps Last checked, then the aside");
  assert.match(src, /skipToday: !!failed\?\.line/);
});

test("8 Oct 2026 (review of audit data-3): a failed check that stored answers did not finish - it did not read nothing", () => {
  // runner.ts stores the answers before the keyword positions; a failure after that, or the stall sweep, marks
  // the run failed with answers every figure counts. "None of its reads came back" and "the figures run to
  // yesterday" were then both untrue. The answers say which it was.
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const r = { from: addDays(fx.today, -27), to: fx.today };
  const stored = { ...fx.data, runs: (fx.data.runs ?? []).map((x) => (x.run_date === fx.today ? { ...x, status: "failed", error: "could not store the keyword positions: timeout" } : x)) };
  assert.equal(storedAnswers(stored.answers, fx.today), true, "the default fixture answered today");
  const failed = fixtureState(fx, { TRACKING_FIXTURE_STATE: "failed" }).data;
  assert.equal(storedAnswers(failed.answers, fx.today), false, "the failed state's today stored nothing answered");
  assert.equal(runNote(stored, r, fx.today), "Today's check did not finish. Any reads it did not store are left out of the figures, not counted as misses.");
  assert.match(runNote(failed, r, fx.today)!, /^Today's check failed: none of its reads came back/);
  assert.deepEqual(failedTodayNote(stored, r, fx.today), { line: "Today's check did not finish, so some of today's reads may be missing.", aside: null });
  assert.deepEqual(failedTodayNote(stored, { from: "2026-08-05", to: "2026-09-01" }, fx.today), { line: null, aside: "Today's check did not finish." });
  assert.equal(failedTodayLine("2026-09-28", true), "Today's check did not finish, so some of today's reads may be missing.");
  assert.equal(failedTodayAside(), "Today's check failed.");
  // Listed among several, it reads "did not finish" too.
  const two = { ...stored, runs: [...stored.runs, { run_date: "2026-09-20", status: "partial", error: null }] };
  assert.equal(runNote(two, r, fx.today), `2 checks in this range lost reads: 20 Sep (partial) and today (did not finish). ${MISSING_READS}`);
});

test("8 Oct 2026 (audit reliability-1 / data-6): a run partial only for a brand gap lost no read, so it says nothing of reads", () => {
  const gap = { engine: "chatgpt", unread: 20, answered: 20, reason: "language model error 529: Overloaded" };
  const brandOnly = { ...run("2026-09-29", "partial"), error: failureSummary(80, [], [gap]) };
  assert.equal(lostReads(brandOnly), false);
  assert.equal(partialRunNote(brandOnly, range, "2026-09-29"), null);
  const both = { ...run("2026-09-29", "partial"), error: failureSummary(80, [{ engine: "google_aio", reason: "HTTP 429" }], [gap]) };
  assert.equal(lostReads(both), true);
  assert.equal(partialRunNote(both, range, "2026-09-29"), `Today's check was partial. ${MISSING_READS}`);
  assert.equal(lostReads(run("2026-09-29", "partial")), true, "no error line: partial meant lost reads, as before");
  assert.equal(lostReads({ ...brandOnly, status: "complete" }), false);
});

test("8 Oct 2026: the brand gap note names the engine and day, then counts", () => {
  assert.equal(brandGapNote([]), null);
  assert.equal(
    brandGapNote([{ day: "2026-10-03", engine: "chatgpt", answers: 12 }]),
    "Other brands were not read in 12 answers (ChatGPT on 3 Oct), so they are left out of the brand shares rather than counted as naming no one else.",
  );
  assert.match(brandGapNote([{ day: "2026-10-03", engine: "gemini", answers: 1 }])!, /^Other brands were not read in 1 answer \(Gemini on 3 Oct\), so it is left out/);
  const many = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map((day) => ({ day, engine: "google_aio", answers: 1_000 }));
  assert.match(brandGapNote(many)!, /^Other brands were not read in 5,000 answers \(Google AI Overviews on 1 Oct, Google AI Overviews on 2 Oct, Google AI Overviews on 3 Oct and 2 more\)/);
});

test("8 Oct 2026: the screens that draw brand shares say when answers are left out, and the Overview's partial line asks lostReads", () => {
  const src = (f: string) => readFileSync(new URL(`../../components/app/${f}.tsx`, import.meta.url), "utf8");
  for (const f of ["Overview", "Named"]) assert.match(src(f), /brandGapNote\(/, `${f} draws the brand gap note`);
  assert.match(src("OneCluster"), /brandGaps\(/, "the one-cluster page counts a prompt's unread answers");
  assert.match(src("OneCluster"), /tab\.othersRead/, "and its answer tab says when the others were not read");
  assert.match(src("Overview"), /const missing = lostReads\(data\.lastRun\)/);
  assert.ok(!src("Overview").includes('data.lastRun?.status === "partial" ? ` ${MISSING_READS}`'), "a brand-only partial is not lost reads");
});

test("8 Oct 2026 (review of reliability-1 / data-6): the one-cluster answer tab and the Clusters prompts ask lostReads too", () => {
  // A brand-only partial said "No answer came back from Google AI Overviews" of a stored silence, and
  // hid the Clusters page's upgrade prompts, which are judged on named rates and keyword positions.
  const src = (f: string) => readFileSync(new URL(`../../components/app/${f}.tsx`, import.meta.url), "utf8");
  assert.match(src("OneCluster"), /unsure=\{!data\.lastRun \|\| data\.lastRun\.run_date !== latest\.day \|\| lostReads\(data\.lastRun\)\}/);
  // Merge of audit packages A and B (8 Oct 2026): B also made a failed check today partial here (audit data-3).
  // Both facts hold - lostReads for the last run shown, and today's run when it failed - in one line.
  assert.match(src("Clusters"), /const state = shown\.length === 0 \? "empty" : lostReads\(data\.lastRun\) \|\| todayRun\(data\.runs, today\)\?\.status === "failed" \? "partial" : "ok";/);
  for (const f of ["Overview", "Clusters", "OneCluster", "Named", "Cited"]) {
    assert.ok(!/lastRun\??\.status === "(partial|complete)"/.test(src(f)), `${f} reads a partial run through run-note.ts, not its status`);
  }
});

test("8 Oct 2026 (merge of audit packages A and B): runNote lists no brand-only partial run, and names only the reads that failed", () => {
  // B's runNote read every partial run in the range as lost reads; A made a run partial when brand
  // extraction failed, which lost no read. Both rules hold: such a run is left out of the range's note
  // (brandGapNote speaks for it where brands are shown), and a run that lost reads and brands names the reads.
  const gap = { engine: "chatgpt", unread: 20, answered: 20, reason: "language model error 529: Overloaded" };
  const brandOnly = failureSummary(80, [], [gap]);
  const both = failureSummary(80, [{ engine: "google_aio", reason: "HTTP 429" }], [gap]);
  assert.equal(runLostReads({ status: "partial", error: brandOnly }), false);
  assert.equal(runLostReads({ status: "partial", error: both }), true);
  assert.equal(runLostReads({ status: "partial", error: null }), true, "no error line: partial meant lost reads, as before");
  assert.equal(runLostReads({ status: "failed", error: brandOnly }), true, "a failed run lost reads whatever its line");
  assert.equal(runLostReads({ status: "complete", error: null }), false);
  const data = (rs: ReturnType<typeof runs>) => ({ lastRun: null, runs: rs });
  assert.equal(runNote(data(runs([today, "partial", brandOnly!])), range, today), null);
  assert.equal(runNote(data(runs([today, "partial", brandOnly!], ["2026-09-20", "partial", "2 of 21 reads failed - perplexity: 2 x timeout"])), range, today), `The check on 20 Sep was partial (Perplexity). ${MISSING_READS}`);
  assert.equal(runNote(data(runs([today, "partial", both!])), range, today), `Today's check was partial (Google AI Overviews). ${MISSING_READS}`, "the brand line names no read");
  assert.deepEqual(failedReadNames(both), ["Google AI Overviews"]);
  // The brands-unread fixture state is a brand-only partial today: no lost-reads note on any page.
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const unread = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" }).data;
  assert.equal(lostReads(unread.lastRun), false);
  assert.equal(runNote(unread, { from: addDays(fx.today, -27), to: fx.today }, fx.today), null);
});

test("8 Oct 2026 (merge of audit packages B and C): on a read of some prompts, a day none was asked claims nothing of what the check stored", () => {
  // The one-cluster page reads only its prompts' answers. A cluster whose first check is tomorrow has none on a
  // day the check failed after storing every other prompt's: "none of its reads came back" was then untrue.
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const r = { from: addDays(fx.today, -27), to: fx.today };
  const runs = (fx.data.runs ?? []).map((x) => (x.run_date === fx.today ? { ...x, status: "failed", error: "could not store the keyword positions: timeout" } : x));
  const pending = fx.data.clusters.find((c) => c.started_on > fx.today)!;
  const ids = new Set(fx.data.questions.filter((q) => q.cluster_id === pending.id).map((q) => q.id));
  const own = { lastRun: fx.data.lastRun, runs, answers: fx.data.answers.filter((a) => ids.has(a.question_id)) };
  const askedOn = (d: string) => fx.data.questions.some((q) => ids.has(q.id) && q.added_on <= d && (q.stopped_on === null || q.stopped_on > d));
  assert.equal(askedOn(fx.today), false, `${pending.id} is not asked until tomorrow`);
  assert.match(runNote(own, r, fx.today)!, /none of its reads came back/, "without askedOn its own answers read as nothing stored");
  const said = "Today's check failed. Any reads it did not store are left out of the figures, not counted as misses.";
  assert.equal(runNote(own, r, fx.today, { askedOn }), said);
  assert.equal(runNote({ ...own, answers: fx.data.answers }, r, fx.today, { askedOn }), said, "the same on the whole read: the note is the page's, whatever was read");
  // A prompt asked that day: its answers say what the whole read does, both ways.
  const live = new Set(fx.data.questions.filter((q) => q.cluster_id === "c1").map((q) => q.id));
  const c1 = (d: string) => fx.data.questions.some((q) => live.has(q.id) && q.added_on <= d && (q.stopped_on === null || q.stopped_on > d));
  const mine = { ...own, answers: fx.data.answers.filter((a) => live.has(a.question_id)) };
  assert.equal(runNote(mine, r, fx.today, { askedOn: c1 }), runNote({ lastRun: fx.data.lastRun, runs, answers: fx.data.answers }, r, fx.today));
  assert.match(runNote(mine, r, fx.today, { askedOn: c1 })!, /did not finish/);
  const failed = fixtureState(fx, { TRACKING_FIXTURE_STATE: "failed" }).data;
  assert.match(runNote({ ...failed, answers: failed.answers.filter((a) => live.has(a.question_id)) }, r, fx.today, { askedOn: c1 })!, /^Today's check failed: none of its reads came back/);
  // Listed among several, a day it was not asked reads "failed", never "did not finish".
  const two = [...runs, { run_date: "2026-09-20", status: "partial", error: null }];
  assert.equal(runNote({ ...own, runs: two }, r, fx.today, { askedOn }), `2 checks in this range lost reads: 20 Sep (partial) and today (failed). ${MISSING_READS}`);
});
