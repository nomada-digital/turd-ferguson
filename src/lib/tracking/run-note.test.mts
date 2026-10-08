import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { addDays } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { MISSING_READS, failedReadNames, failedTodayLine, latestAnswersNote, partialRunNote, runNote, todayRun } from "./run-note.ts";

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
    assert.match(src, /runNote\(data, range, today\)/, `${f} notes every lost check in its range`);
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
