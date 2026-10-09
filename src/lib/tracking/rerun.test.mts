import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type BrandGap, failureSummary, runOutcome } from "./decide.ts";
import { type Row, fakeDb } from "./fake-db.mts";
import {
  type Kept,
  type RunForRerun,
  brandGapEngines,
  dayRows,
  keepsOld,
  nextMarker,
  readKept,
  reopenRun,
  rerunMarker,
  rerunVerdict,
  restored,
  retryAnswers,
  retryKeywords,
} from "./rerun.ts";

/**
 * Re-running a day's failed reads (9 Oct 2026, audit reliability-4).
 *
 * A failed, partial or killed run could never be read again: "Run now"
 * refused anything not queued and the claim moves only queued to running.
 * These hold the reopen (a compare-and-swap that never takes a run still
 * reading), what a re-run asks again, what it leaves alone, and that it never
 * leaves the day worse than it found it - against an in-memory database
 * (fake-db.mts), nothing real read or written.
 */

const DAY = "2026-10-09";
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00Z`);

const row = (over: Partial<RunForRerun> = {}): RunForRerun => ({ id: "r1", run_date: DAY, status: "partial", error: "4 of 21 reads failed - google_aio: 4 x HTTP 429", started_at: `${DAY}T05:00:03Z`, step_ms: { total: 61_000 }, ...over });

test("which runs may be re-run: today's failed, partial or stalled; never one still reading inside 15 minutes", () => {
  assert.deepEqual(rerunVerdict(row({ status: "failed" }), DAY, at("08:00")), { ok: true, of: "failed" });
  assert.deepEqual(rerunVerdict(row({ status: "partial" }), DAY, at("08:00")), { ok: true, of: "partial" });
  const reading = rerunVerdict(row({ status: "running", started_at: `${DAY}T07:55:00Z` }), DAY, at("08:00"));
  assert.equal(reading.ok, false, "running five minutes: genuinely still reading");
  assert.match((reading as { message: string }).message, /running \(since 07:55Z\).*after 15 minutes/);
  assert.deepEqual(rerunVerdict(row({ status: "running", started_at: `${DAY}T05:00:03Z` }), DAY, at("05:15")), { ok: false, message: "Today's run is running (since 05:00Z). It can be re-run once it ends, or after 15 minutes if it never does." });
  assert.deepEqual(rerunVerdict(row({ status: "running", started_at: `${DAY}T05:00:03Z` }), DAY, at("05:16")), { ok: true, of: "stalled" });
  assert.deepEqual(rerunVerdict(row({ status: "complete" }), DAY, at("08:00")), { ok: false, message: "Today's run is already complete." });
  assert.equal(rerunVerdict(row({ run_date: "2026-10-08" }), DAY, at("08:00")).ok, false, "a reading is dated the day it is read: never yesterday's run");
});

function runs(rows: Row[]) {
  return fakeDb({ tracking_runs: rows.map((r) => ({ ...r })) });
}

test("the reopen is a compare-and-swap: it refuses a run genuinely still running inside 15 minutes, whatever the caller decided", async () => {
  const live = { id: "r1", run_date: DAY, status: "running", error: null, started_at: `${DAY}T07:55:00Z`, step_ms: null };
  const { db, tables } = runs([live]);
  // Called past the verdict, as a stale page's second click would.
  assert.equal(await reopenRun(db, live, "stalled", at("08:00")), false);
  assert.equal(tables.tracking_runs![0]!.status, "running", "the run reading is untouched");
  // The same row 16 minutes on is dead, and is reopened.
  assert.equal(await reopenRun(db, live, "stalled", at("08:11")), true);
  assert.equal(tables.tracking_runs![0]!.status, "queued");
});

test("a failed or partial run goes back to queued with its marker; a second reopen finds nothing to move", async () => {
  const partial = { id: "r1", run_date: DAY, status: "partial", error: "4 of 21 reads failed - google_aio: 4 x HTTP 429", started_at: `${DAY}T05:00:03Z`, step_ms: { total: 61_000 } };
  const { db, tables } = runs([partial, { ...partial, id: "r2" }]);
  assert.equal(await reopenRun(db, partial, "partial", at("08:00")), true);
  const r = tables.tracking_runs![0]!;
  assert.equal(r.status, "queued");
  assert.equal(r.error, null, "queued with no dispatch error on it");
  assert.deepEqual(rerunMarker(r.step_ms), { of: "partial", error: partial.error, at: `${DAY}T08:00:00.000Z`, n: 1, landed: true });
  assert.equal(tables.tracking_runs![1]!.status, "partial", "only the row named");
  // A double click: the row is queued now, so the swap from partial matches nothing.
  assert.equal(await reopenRun(db, partial, "partial", at("08:00")), false);
});

test("the marker: counted, its landing carried, and a stalled run's line said", () => {
  const first = nextMarker(row({ status: "partial" }), "partial", at("08:00"));
  assert.deepEqual([first.n, first.landed], [1, true], "a partial pass landed: first_reading was considered then");
  // That re-run threw, so it was closed back to partial with the marker kept; then failed on a third pass.
  const again = nextMarker(row({ status: "failed", error: "x", step_ms: { total: 1, rerun: first } }), "failed", at("09:00"));
  assert.deepEqual([again.n, again.landed, again.of], [2, true, "failed"], "landed stays true however the day went after");
  const failedFirst = nextMarker(row({ status: "failed", error: "today's tracking spend $25.00 has reached the cap of $25.00", step_ms: { total: 5 } }), "failed", at("08:00"));
  assert.equal(failedFirst.landed, false, "a run that only ever failed never sent first_reading, so a re-run that lands may");
  const stalled = nextMarker(row({ status: "running", error: null, step_ms: null }), "stalled", at("08:00"));
  assert.equal(stalled.error, "the run was stopped before it could record a result");
  assert.equal(rerunMarker({ total: 3 }), null, "the cron's pass carries none");
  assert.equal(rerunMarker(null), null);
  assert.equal(rerunMarker({ rerun: { of: "complete" } }), null, "a marker from nowhere is not trusted");
});

test("a re-run the cap refuses or that throws is closed back to what it was, with why", () => {
  const m = nextMarker(row({ status: "partial" }), "partial", at("08:00"));
  assert.deepEqual(restored(m, "re-run refused: today's tracking spend $25.00 has reached the cap of $25.00"), {
    status: "partial",
    error: "4 of 21 reads failed - google_aio: 4 x HTTP 429 - re-run refused: today's tracking spend $25.00 has reached the cap of $25.00",
  });
  assert.equal(restored(nextMarker(row({ status: "running", error: null }), "stalled", at("08:00")), "re-run failed: x").status, "failed", "a stalled run is dead: failed, never running again");
  assert.equal(restored(nextMarker(row({ status: "failed", error: "y" }), "failed", at("08:00")), "z").error, "y - z");
});

const kept = (over: Partial<Kept> = {}): Kept => ({
  answers: [
    { run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: ["Rival"], brands_ok: true },
    { run_date: DAY, question_id: "q1", engine: "google_aio", answered: false, named: false, brands: [], brands_ok: true },
    { run_date: DAY, question_id: "q2", engine: "chatgpt", answered: true, named: false, brands: [], brands_ok: false },
  ],
  serp: [{ run_date: DAY, keyword_id: "k1", position: 4 }],
  ...over,
});

test("what a re-run asks again: no row, an answer that did not come back, or one whose brands were not read", () => {
  const ask = retryAnswers(kept(), null);
  assert.equal(ask("q1", "chatgpt"), false, "answered with its brands read: kept as it was read");
  assert.equal(ask("q1", "google_aio"), true, "unanswered: a failure and a silence look the same, so both are asked");
  assert.equal(ask("q2", "chatgpt"), true, "brands not read");
  assert.equal(ask("q2", "google_aio"), true, "no row at all");
  const read = retryKeywords(kept());
  assert.equal(read("k1"), false);
  assert.equal(read("k2"), true, "a failed keyword read stores no row");
});

test("before brands_ok exists, the engines the error line names as a brand gap are asked again", () => {
  const gap: BrandGap[] = [{ engine: "chatgpt", unread: 12, answered: 20, reason: "language model error 529: Overloaded" }];
  const line = failureSummary(21, [{ engine: "google_aio", reason: "HTTP 429" }], gap);
  assert.deepEqual([...brandGapEngines(line)], ["chatgpt"], "read off failureSummary's own words");
  assert.deepEqual([...brandGapEngines("4 of 21 reads failed - google_aio: 4 x HTTP 429")], []);
  assert.deepEqual([...brandGapEngines(null)], []);
  const noColumn = kept({ answers: kept().answers.map(({ brands_ok: _, ...a }) => a) });
  assert.equal(retryAnswers(noColumn, line)("q1", "chatgpt"), true, "the rows cannot say which chatgpt answers were missed");
  assert.equal(retryAnswers(noColumn, null)("q1", "chatgpt"), false, "with no gap named, an answered row is read, as the column's default says");
});

test("a re-read that fails again leaves the row it found; the cron's pass, keeping nothing, writes every row", () => {
  assert.equal(keepsOld(kept(), { question_id: "q1", engine: "google_aio", failed: true }), true);
  assert.equal(keepsOld(kept(), { question_id: "q1", engine: "google_aio", failed: false }), false, "a read that landed replaces it");
  assert.equal(keepsOld(kept(), { question_id: "q9", engine: "chatgpt", failed: true }), false, "nothing to keep: the failed row is written");
  assert.equal(keepsOld(null, { question_id: "q1", engine: "google_aio", failed: true }), false);
  const day = dayRows(kept(), [{ question_id: "q1", engine: "google_aio", answered: true, named: true }], [{ keyword_id: "k2", position: 9 }]);
  assert.equal(day.answers.length, 3, "the re-read replaces its row; the rest are the day's own");
  assert.equal(day.answers.filter((a) => a.answered && a.named).length, 2);
  assert.deepEqual(day.serp.map((s) => s.keyword_id).sort(), ["k1", "k2"]);
});

test("acceptance: a partial run re-run ends complete when its failed reads come back, partial when one does not", () => {
  // The runner's arithmetic (runner.ts): the denominator is the whole day; the failures are the reads asked again that failed again.
  const every = 21 + 2; // 7 prompts x 3 engines, 2 keywords
  const before = runOutcome(every, 4);
  assert.equal(before, "partial");
  assert.equal(runOutcome(every, 0, 0), "complete", "all four came back");
  assert.equal(runOutcome(every, 1, 0), "partial");
  assert.equal(failureSummary(every, [{ engine: "google_aio", reason: "HTTP 429" }]), "1 of 23 reads failed - google_aio: 1 x HTTP 429");
});

test("readKept reads the run's rows, and again without brands_ok while 20261008020000 is not applied", async () => {
  const answers: Row[] = [{ id: "a1", run_id: "r1", run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["X", 3], brands_ok: false }, { id: "a2", run_id: "other", run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [] }];
  const { db } = fakeDb({ tracking_answers: answers, tracking_serp: [{ id: "s1", run_id: "r1", run_date: DAY, keyword_id: "k1", position: null }] });
  const k = await readKept(db, "r1");
  assert.deepEqual(k.answers, [{ run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["X"], brands_ok: false }]);
  assert.deepEqual(k.serp, [{ run_date: DAY, keyword_id: "k1", position: null }]);
  // A table without the column: the first select is refused as PostgREST refuses it (42703).
  const base = fakeDb({ tracking_answers: answers.map(({ brands_ok: _, ...a }) => a), tracking_serp: [] });
  const from = base.db.from.bind(base.db);
  (base.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const b = from(t) as unknown as { select: (c: string) => unknown };
    const select = b.select.bind(b);
    b.select = (c: string) => (c.includes("brands_ok") ? { eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: "column tracking_answers.brands_ok does not exist" } }) }) }) } : select(c));
    return b;
  };
  const without = await readKept(base.db, "r1");
  assert.equal(without.answers.length, 1);
  assert.equal("brands_ok" in without.answers[0]!, false, "absent, as figures.ts reads a row from before the column");
});

test("census: the runner's re-run is the cron's pass with nothing kept", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("export async function runTrackingDay"), runner.indexOf("async function mailFirstReading"));
  // The claim hands back what a re-run needs; the cron's row has 0, 0 and no marker.
  assert.match(body, /\.eq\("status", "queued"\)\s*\.select\("id, client_domain_id, run_date, engines, dfs_cost, model_calls, step_ms"\);/);
  assert.match(body, /const rerun = rerunMarker\(run\.step_ms\);/);
  // Spend adds to what the run's earlier passes billed, so the daily cap still counts them.
  assert.match(body, /dfs_cost: Number\(\(prior\.dfs \+ spend\.dfs\)\.toFixed\(4\)\),\s*model_calls: prior\.calls \+ spend\.calls,/);
  // Only what did not come back is asked again; on the cron's pass kept is null and jobs is every.
  assert.match(body, /const kept = rerun \? await readKept\(db, runId\) : null;/);
  assert.match(body, /const jobs = askAgain \? every\.filter\(\(\{ q, engine \}\) => askAgain\(q\.id as string, engine\)\) : every;/);
  assert.match(body, /mapWithConcurrency\(jobs, CONCURRENCY/);
  assert.match(body, /mapWithConcurrency\(keywordJobs, CONCURRENCY/);
  assert.match(body, /const written = answerRows\.filter\(\(_, i\) => !keepsOld\(kept, answers\[i\]!\)\);/);
  assert.match(body, /const reads = every\.length \+ keywords\.length;/);
  // Never worse: refused or thrown, it closes back to what it was.
  assert.match(body, /const out = rerun \? restored\(rerun, `re-run refused: \$\{refusal\}`\) : \{ status: "failed", error: refusal \};/);
  assert.match(body, /await close\(rerun \? restored\(rerun, `re-run failed: \$\{message\(err\)\}`\) : \{ status: "failed", error: message\(err\) \}\);/);
  const actions = readFileSync(new URL("../../app/admin/tracking/actions.ts", import.meta.url), "utf8");
  const runNow = actions.slice(actions.indexOf("export async function runNow"));
  assert.ok(runNow.indexOf("reopenForRerun(") > 0 && runNow.indexOf("reopenForRerun(") < runNow.indexOf("dispatchTrackingRun(run.id as string)"), "reopened before it is dispatched");
  assert.match(runNow, /if \(!reopened\.ok\) return \{ ok: false, message: reopened\.message \};/);
  // The cap is read before anything moves.
  const reopen = runner.slice(runner.indexOf("export async function reopenForRerun"));
  assert.ok(reopen.indexOf("refuseRun(") < reopen.indexOf("reopenRun("), "refused under the switch and the cap before the swap");
});
