import { NextResponse } from "next/server";

import { cancelAtPeriodEnd } from "@/lib/checkout/stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { cancelTrial } from "@/lib/tracking/limits";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { dashPath } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Cancel trial" (Danny, 8 Oct 2026), posted by Settings > Billing's confirm
 * form, so it works with JS off; the answer is a 303 back to Settings with
 * `?trial=cancelled` or `?trial=refused`. Owner only, here and again in
 * limits.ts cancelTrial, which makes the Stripe call and records the event.
 * The fixture has no subscription, so it refuses.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const back = (done: "cancelled" | "refused") => NextResponse.redirect(new URL(dashPath(req, `/${slug}/settings?trial=${done}`), req.url), 303);
  const form = await req.formData().catch(() => null);
  if (form?.get("confirm") !== "1") return back("refused");
  if (fixtureMode()) return back("refused");

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(new URL(dashPath(req, "/login"), req.url), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const r = await cancelTrial(supabaseAdmin(), {
    clientId: client.id,
    role: client.role,
    by: email,
    now: Date.now(),
    cancel: async (id) => {
      const s = await cancelAtPeriodEnd(id);
      if (!s.ok) console.error(`[app] trial cancel refused by Stripe: ${s.reason} ${s.status ?? ""}`.trim());
      return s.ok && s.cancelAtPeriodEnd;
    },
  });
  if (!r.ok) {
    console.warn(`[app] trial cancel refused: ${r.message}`);
    return back("refused");
  }
  return back("cancelled");
}
