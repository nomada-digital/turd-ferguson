import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureFillSlot } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { fillSlot, slotWhyOf } from "@/lib/tracking/slot";
import { type StopDone, readStopForm, stopReturn } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fill a free slot: track a new prompt in a cluster - BRIEF-3 T6 part 2c (30
 * Sep 2026). Posted by the plain HTML free-slot form on the Clusters page: the
 * cluster, the angle and the page state in the action's query string, the typed
 * prompt in the body. The rules and the insert are slot.ts through limits.ts.
 * Session and membership as the stop route; the fixture writes nothing unless
 * TRACKING_FIXTURE_WRITE=1 (R168) holds it in memory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const f = readStopForm((k) => sp.get(k), APP_LIMITS.search);
  if (!f || f.kind !== "cluster") return NextResponse.json({ error: "Not a prompt this page can add." }, { status: 400 });
  // R151 (3 Oct 2026): a rule's refusal carries its code (slot.ts SLOT_WHY), so the toast says why.
  const back = (done: StopDone, id = f.id, message = "") =>
    NextResponse.redirect(dashUrl(req, stopReturn(slug, { ...f, kind: done === "added" ? "prompt" : "cluster", id }, done, undefined, slotWhyOf(message))), 303);
  const form = await req.formData().catch(() => null);
  const text = typeof form?.get("text") === "string" ? (form.get("text") as string) : "";
  if (fixtureMode()) {
    // R168: with TRACKING_FIXTURE_WRITE=1 the new prompt is held in memory; otherwise the fixture refuses it.
    const r = writeFixture((fx) => fixtureFillSlot(fx, { clusterId: f.id, angle: sp.get("angle"), text, today: fx.today, role: fx.member.role }));
    if (r && !r.ok) console.warn(`[app] fixture free slot refused: ${r.message}`);
    return r?.ok && r.id ? back("added", r.id) : back("refused", f.id, r && !r.ok ? r.message : "");
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const r = await fillSlot(supabaseAdmin(), { clientId: client.id, clusterId: f.id, angle: sp.get("angle"), text, today: trackingDay(), by: email, role: writeRole(client) });
  if (!r.ok) {
    console.warn(`[app] free slot refused: ${r.message}`);
    return back("refused", f.id, r.message);
  }
  return back("added", r.id);
}
