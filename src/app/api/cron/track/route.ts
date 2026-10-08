import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { sweepLifecycleMailSafely } from "@/lib/email/lifecycle-sweep";
import { dispatchTrackingRuns } from "@/lib/tracking/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily alwaystracked check - T1 of
 * docs/tracked-dashboard-2026-09-29/BRIEF.md (Danny, 29 Sep 2026).
 *
 * Scheduled `0 5 * * *` UTC, which is 06:00 in London in summer and 05:00 in
 * winter; the dashboard states the time from `finished_at`, never a promise.
 * One cron for every client, so it works whatever the Vercel plan allows:
 * this opens today's `tracking_runs` row per client and hands each one to its
 * own `/api/track/run` invocation, signed with CRON_SECRET, without waiting.
 *
 * Bounded by `tracking_enabled` and `tracking_daily_cost_cap_usd`, read in
 * `dispatchTrackingRuns` before anything is opened, and by the unique
 * (client, day) row: a second call the same day dispatches nothing.
 *
 * Vercel Cron calls this with Authorization: Bearer <CRON_SECRET>.
 *
 * After the dispatch, whatever it did, the lifecycle emails that go by the
 * calendar (8 Oct 2026, audit activation-1): trial_midpoint, trial_ending and
 * setup_reminder, each behind its own flag (off until Danny approves it) and
 * once per client (lib/email/lifecycle-sweep.ts). Never fatal to the answer.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const offered = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(offered, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let answer: { body: Record<string, unknown>; status: number };
  try {
    // Dispatched to the canonical origin, never this request's own host: under
    // Vercel Cron that is not necessarily alwayscited.com, and on 30 Sep no run
    // dispatched from it was ever claimed (lib/tracking/dispatch.ts).
    const out = await dispatchTrackingRuns();
    if (out.refused) console.warn(`[track] daily check refused: ${out.refused}`);
    answer = { body: { ok: true, ...out }, status: 200 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[track] daily check failed: ${error}`);
    answer = { body: { ok: false, error }, status: 502 };
  }
  const mail = await sweepLifecycleMailSafely();
  return NextResponse.json({ ...answer.body, mail }, { status: answer.status });
}
