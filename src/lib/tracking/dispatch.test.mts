import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SITE_URL } from "../../config/schema.ts";

import { verifyRun } from "./decide.ts";
import { TRACK_RUN_URL, TRACKING_STUCK_MS, dispatchRun, postRun, runIsStalled, runIsStuck } from "./dispatch.ts";

/**
 * The 30 Sep 2026 failure: the 05:00Z cron opened both pilots' runs and
 * neither was claimed, with nothing on the rows to say why. These hold the
 * three things that would have caught it: the dispatch goes to the canonical
 * origin whatever host the cron was called on, a failed dispatch writes its
 * reason onto the row, and a run left queued reads as stuck.
 */

const RUN = "3f2a9c1e-0b4d-4e6f-8a1b-2c3d4e5f6a7b";
const SECRET = "test-secret";

test("dispatch posts to the canonical production origin, signed so the run route accepts it", async () => {
  assert.equal(TRACK_RUN_URL, `${SITE_URL}/api/track/run`);
  // SITE_URL is the production custom domain, not a deployment host.
  assert.match(SITE_URL, /^https:\/\/[a-z0-9.-]+$/);
  assert.doesNotMatch(SITE_URL, /vercel\.app|localhost/);
  const calls: { url: string; body: string; sig: string }[] = [];
  const out = await postRun(RUN, SECRET, async (url, init) => {
    calls.push({ url, body: init.body, sig: init.headers["x-track-signature"] });
    return { status: 202 };
  });
  assert.deepEqual(out, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SITE_URL}/api/track/run`);
  assert.ok(verifyRun(calls[0].body, calls[0].sig, SECRET), "the run route's verifyRun accepts what dispatch signs");
});

test("no dispatcher takes its origin from the request (the cron's req.url, or Run now's Host header)", () => {
  const cron = readFileSync(new URL("../../app/api/cron/track/route.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../../app/admin/tracking/actions.ts", import.meta.url), "utf8");
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cron, /req\.url/, "the cron route must not derive a dispatch origin from req.url");
  assert.match(cron, /dispatchTrackingRuns\(\)/);
  assert.doesNotMatch(actions, /x-forwarded-host|get\("host"\)/, "Run now must not dispatch to the request's Host");
  assert.match(actions, /dispatchTrackingRun\(run\.id as string\)/);
  assert.match(runner, /dispatchRun\(/, "runner dispatches through dispatch.ts");
  assert.doesNotMatch(runner, /fetch\(`\$\{origin\}/, "no origin-parameter fetch left in runner");
});

test("a non-202 records the reason on the run and throws; the run is left queued for Run now", async () => {
  for (const status of [401, 307, 500]) {
    const recorded: [string, string][] = [];
    await assert.rejects(
      dispatchRun(RUN, SECRET, async () => ({ status }), async (id, reason) => void recorded.push([id, reason])),
      new RegExp(`answered ${status}`),
    );
    assert.deepEqual(recorded, [[RUN, `dispatch failed: the run route answered ${status}`]]);
  }
});

test("a dispatch that never gets an answer records that too", async () => {
  const recorded: string[] = [];
  await assert.rejects(
    dispatchRun(RUN, SECRET, async () => { throw new Error("The operation was aborted due to timeout"); }, async (_id, reason) => void recorded.push(reason)),
    /timeout/,
  );
  assert.deepEqual(recorded, ["dispatch failed: The operation was aborted due to timeout"]);
});

test("a 202 records nothing", async () => {
  let recorded = 0;
  await dispatchRun(RUN, SECRET, async () => ({ status: 202 }), async () => void recorded++);
  assert.equal(recorded, 0);
});

test("a queued run older than 30 minutes is stuck; a fresh, claimed or finished one is not", () => {
  const now = Date.parse("2026-09-30T06:50:00Z");
  assert.equal(TRACKING_STUCK_MS, 30 * 60 * 1000);
  // Both pilots on 30 Sep: opened by the 05:00Z cron, never claimed.
  assert.equal(runIsStuck({ status: "queued", created_at: "2026-09-30T05:00:04Z", started_at: null }, now), true);
  assert.equal(runIsStuck({ status: "queued", created_at: "2026-09-30T06:30:00Z", started_at: null }, now), false);
  assert.equal(runIsStuck({ status: "running", created_at: "2026-09-30T05:00:04Z", started_at: "2026-09-30T05:00:06Z" }, now), false);
  assert.equal(runIsStuck({ status: "complete", created_at: "2026-09-30T05:00:04Z" }, now), false);
  assert.equal(runIsStuck({ status: "queued", created_at: null }, now), false);
});

/**
 * 9 Oct 2026 (audit reliability-4): a run the platform killed stays `running`
 * until the 03:45 stall sweep, almost a day after a 05:00 run, and admin read
 * it as "running $0.00". Past TRACKING_STALL_MS it is stalled: labelled so,
 * counted by run health, and re-runnable.
 */
test("a running run older than 15 minutes is stalled; a fresh, queued or closed one is not", () => {
  const now = Date.parse("2026-10-09T05:20:00Z");
  assert.equal(runIsStalled({ status: "running", started_at: "2026-10-09T05:04:59Z" }, now), true);
  assert.equal(runIsStalled({ status: "running", started_at: "2026-10-09T05:05:00Z" }, now), false, "exactly 15 minutes is not past it");
  assert.equal(runIsStalled({ status: "running", started_at: "2026-10-09T05:19:00Z" }, now), false);
  assert.equal(runIsStalled({ status: "queued", started_at: null }, now), false, "queued is runIsStuck's");
  assert.equal(runIsStalled({ status: "failed", started_at: "2026-10-09T05:00:00Z" }, now), false);
  assert.equal(runIsStalled({ status: "running", started_at: null }, now), false, "no start, no claim to judge");
});
