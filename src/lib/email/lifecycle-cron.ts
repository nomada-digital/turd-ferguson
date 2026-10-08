import "server-only";

import { TRACKED_PRICE } from "@/config/pricing";
import { sendLifecycle } from "@/lib/email/lifecycle-mail";
import { type SweepIo, type SweepResult, sweepLifecycleMail } from "@/lib/email/lifecycle-sweep";
import { siteUrl } from "@/lib/scan/verify-email";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The live wiring of lifecycle-sweep.ts (8 Oct 2026, review of 7e133a7): the
 * sweep takes its sender, origin and price as an argument so node --test can
 * run it against a fake database (lifecycle-sweep.test.mts), and this is the
 * one place the real ones are handed in - Resend through sendLifecycle, the
 * canonical origin, TRACKED_PRICE. The Stripe webhook's trial_will_end uses
 * lifecycleIo too, so the cron and the webhook cannot word a trial_ending
 * differently.
 */
export function lifecycleIo(): SweepIo {
  return { send: sendLifecycle, origin: siteUrl(), price: TRACKED_PRICE };
}

/** The cron's call: its own admin client, and nothing it does can fail the dispatch's answer. */
export async function sweepLifecycleMailSafely(): Promise<SweepResult | { error: string }> {
  try {
    const out = await sweepLifecycleMail(supabaseAdmin(), lifecycleIo());
    for (const e of out.errors) console.warn(`[mail] lifecycle sweep: ${e}`);
    return out;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.warn(`[mail] lifecycle sweep failed: ${error}`);
    return { error };
  }
}
