import { NextResponse, after } from "next/server";

import { RUN_SIGNATURE_HEADER, verifyRun } from "@/lib/tracking/decide";
import { runTrackingDay } from "@/lib/tracking/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One client's daily tracking run (T1, 29 Sep 2026). Posted by
 * `/api/cron/track`, and later by the admin "Run now" button, with an
 * HMAC-SHA256 of the body keyed on CRON_SECRET. Nothing else can start one.
 *
 * Bounded three ways before a read is made: the signature; the claim in
 * `runTrackingDay`, which moves only a `queued` row to `running`, so a run
 * already running or finished is skipped however often this is posted - or,
 * for a run the admin asked to re-run (9 Oct 2026, rerun.ts claimRerun),
 * takes that ask once by a compare-and-swap on its marker; and
 * `tracking_enabled` / `tracking_daily_cost_cap_usd`, re-read at the claim.
 * The run budgets 270s against this route's 300 and writes its own status on
 * the way out; the stall reaper closes one the platform killed.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });

  const body = await req.text();
  if (!verifyRun(body, req.headers.get(RUN_SIGNATURE_HEADER), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let runId: unknown;
  try {
    runId = (JSON.parse(body) as { runId?: unknown }).runId;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ error: "bad run id" }, { status: 400 });
  }

  // Answered at once and run after the response, under this route's 300s, so
  // the dispatcher's await is a handshake rather than the whole run.
  const id = runId;
  after(async () => {
    try {
      const out = await runTrackingDay(id);
      console.log(`[track] run ${id}: ${out.status}${out.skipped ? ` (${out.skipped})` : ""}`);
    } catch (err) {
      console.warn(`[track] run ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return NextResponse.json({ ok: true, runId }, { status: 202 });
}
