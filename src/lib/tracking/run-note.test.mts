import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { failureSummary } from "./decide.ts";
import { MISSING_READS, brandGapNote, lostReads, partialRunNote } from "./run-note.ts";

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
  for (const f of ["Overview", "Clusters", "OneCluster", "Named", "Cited"]) {
    const src = readFileSync(new URL(`../../components/app/${f}.tsx`, import.meta.url), "utf8");
    assert.match(src, /from "@\/lib\/tracking\/run-note"/, `${f} imports run-note`);
    assert.ok(!src.includes("did not come back"), `${f} has no copy of the sentence`);
  }
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
