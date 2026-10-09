import { SITE_URL } from "../../config/schema.ts";

import { RUN_SIGNATURE_HEADER, TRACKING_STALL_MS, signRun } from "./decide.ts";

/**
 * Handing a tracking run to its own `/api/track/run` invocation, with nothing
 * in here that needs a credential store or a database - `dispatch.test.mts`
 * runs all of it. `runner.ts` passes the real fetch and a recorder that writes
 * the failure onto the run row.
 *
 * Why the origin is fixed (30 Sep 2026): the 05:00Z cron on 30 Sep opened
 * both pilots' runs and neither was ever claimed - queued, started_at null,
 * error null. The cron dispatched to `new URL(req.url).origin`, and under
 * Vercel Cron that is not necessarily the site's own domain; a dispatch that
 * got anything but a 202 only reached console.warn, so the database showed a
 * queued row and nothing else. The dispatch now always goes to SITE_URL, the
 * canonical production origin, and a failed one writes its reason onto the row.
 */

/** Where every run is dispatched: the production site, never the request's host. */
export const TRACK_RUN_URL = `${SITE_URL}/api/track/run`;

/** A queued run older than this was never claimed, and /admin/tracking says so. */
export const TRACKING_STUCK_MS = 30 * 60 * 1000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;

/**
 * Post one run and report whether the run route took it. A run route that
 * answers anything but 202, or no answer at all, is a failure with a reason
 * short enough to store in `tracking_runs.error`.
 */
export async function postRun(runId: string, secret: string, fetchImpl: FetchLike): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = JSON.stringify({ runId });
  try {
    const res = await fetchImpl(TRACK_RUN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", [RUN_SIGNATURE_HEADER]: signRun(body, secret) },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 202) return { ok: true };
    return { ok: false, reason: `dispatch failed: the run route answered ${res.status}` };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `dispatch failed: ${why}`.slice(0, 300) };
  }
}

/**
 * Dispatch, and on failure record the reason before throwing, so the row
 * carries it even when nobody reads the logs. The row stays queued, which is
 * what lets "Run now" post it again.
 */
export async function dispatchRun(
  runId: string,
  secret: string,
  fetchImpl: FetchLike,
  recordFailure: (runId: string, reason: string) => Promise<void>,
): Promise<void> {
  const out = await postRun(runId, secret, fetchImpl);
  if (out.ok) return;
  try {
    await recordFailure(runId, out.reason);
  } catch (err) {
    console.warn(`[track] could not record the dispatch failure on run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(`${out.reason} (run ${runId})`);
}

/** A run that was opened but never claimed: still queued, and older than TRACKING_STUCK_MS. */
export function runIsStuck(run: { status: string; created_at: string | null; started_at?: string | null }, now: number = Date.now()): boolean {
  if (run.status !== "queued" || run.started_at) return false;
  const created = run.created_at ? Date.parse(run.created_at) : NaN;
  return Number.isFinite(created) && now - created > TRACKING_STUCK_MS;
}

/**
 * A run claimed and never closed: `running` with a start older than
 * TRACKING_STALL_MS, which the run route's 300s ceiling makes a run the
 * platform killed (9 Oct 2026, audit reliability-4). The stall sweep closes
 * these at 03:45 UTC, almost a day after a 05:00 run dies, so /admin/tracking,
 * the run-health report and "Run now" read this instead of waiting for it.
 * runIsStuck stays queued-only: a claimed run was dispatched.
 */
export function runIsStalled(run: { status: string; started_at?: string | null }, now: number = Date.now()): boolean {
  if (run.status !== "running") return false;
  const started = run.started_at ? Date.parse(run.started_at) : NaN;
  return Number.isFinite(started) && now - started > TRACKING_STALL_MS;
}
