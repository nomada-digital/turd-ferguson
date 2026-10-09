import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type Row, fakeDb } from "./fake-db.mts";
import { readTrackable } from "./run-health.ts";

/**
 * Who should be read on a day, past PostgREST's thousand rows (9 Oct 2026,
 * audit reliability-2), against an in-memory database (fake-db.mts) that caps
 * every select as PostgREST does. No real database is read or written.
 */

const DAY = "2026-10-09";

test("reliability-2: 2,500 live prompts across 25 clients - every client is counted and dispatched", async () => {
  const clients: Row[] = [];
  const prompts: Row[] = [];
  for (let c = 0; c < 25; c++) {
    const id = `c${String(c).padStart(2, "0")}`;
    clients.push({ id, domain: `client${c}.example`, status: "active", started_on: "2026-10-01", tier: "tracked" });
    for (let q = 0; q < 100; q++) prompts.push({ id: `${id}-q${String(q).padStart(3, "0")}`, client_domain_id: id, added_on: "2026-10-01", stopped_on: null });
  }
  // Prompts stopped or not yet live are not counted, and an ended client is never read.
  prompts.push({ id: "zz-stopped", client_domain_id: "c00", added_on: "2026-10-01", stopped_on: "2026-10-05" });
  prompts.push({ id: "zz-tomorrow", client_domain_id: "c01", added_on: "2026-10-10", stopped_on: null });
  clients.push({ id: "ended", domain: "ended.example", status: "ended", started_on: "2026-10-01", tier: "tracked" });
  const { db, calls } = fakeDb({ client_domains: clients, tracked_questions: prompts });

  // The read this replaced: one select, no range. PostgREST answers 1,000 rows.
  const { data: old } = (await db.from("tracked_questions").select("client_domain_id, added_on, stopped_on").is("stopped_on", null)) as { data: Row[] };
  const oldCounted = new Set(old.map((q) => q.client_domain_id));
  assert.equal(old.length, 1000, "the stand-in caps a select as PostgREST does");
  assert.ok(oldCounted.size < 25, `the unpaged read saw ${oldCounted.size} of 25 clients - the rest were skipped, silently`);

  const trackable = await readTrackable(db, DAY);
  assert.equal(trackable.length, 25, "active clients only");
  assert.deepEqual(new Set(trackable.map((c) => c.activeQuestions)), new Set([100]), "every client's live prompts, past the thousand");
  assert.equal(trackable.filter((c) => c.track).length, 25, "every client is dispatched");
  assert.ok(calls.filter((c) => c.table === "tracked_questions" && c.range).length >= 3, "read in pages");
});

test("census: the dispatch opens runs off readTrackable's verdict", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("export async function dispatchTrackingRuns"), runner.indexOf("type AnswerRow"));
  assert.match(body, /for \(const client of await readTrackable\(db, day\)\) \{\s*if \(!client\.track\) \{/);
  assert.doesNotMatch(body, /from\("tracked_questions"\)|from\("client_domains"\)/, "no second read of who should run");
});
