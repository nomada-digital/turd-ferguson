import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { editPrompts, readEdits } from "@/lib/tracking/edit";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureEditPrompts } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { slotWhyOf } from "@/lib/tracking/slot";
import { readStopForm, stopReturn } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save a pending cluster's prompts - BRIEF-3 T6 part 2d (30 Sep 2026). Posted
 * by the plain HTML editor on the Clusters page: the cluster and the page state
 * in the action's query string, one `p-<prompt id>` field per prompt in the
 * body. The rules and the writes are edit.ts, which refuses any prompt that
 * already has a reading. Session and membership as the stop route; the fixture
 * writes nothing unless TRACKING_FIXTURE_WRITE=1 (R168) holds it in memory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const f = readStopForm((k) => sp.get(k), APP_LIMITS.search);
  if (!f || f.kind !== "cluster") return NextResponse.json({ error: "Not a cluster this page can edit." }, { status: 400 });
  // R151 (3 Oct 2026): a rule's refusal carries its code (slot.ts SLOT_WHY), so the toast says why.
  const back = (done: "saved" | "refused", message = "") =>
    NextResponse.redirect(dashUrl(req, stopReturn(slug, { ...f, back: { ...f.back, open: f.id } }, done, undefined, slotWhyOf(message))), 303);
  const form = await req.formData().catch(() => null);
  const edits = form ? readEdits(form.entries()) : [];
  if (fixtureMode()) {
    // R168: with TRACKING_FIXTURE_WRITE=1 the edit is held in memory; otherwise the fixture refuses it.
    const r = writeFixture((fx) => fixtureEditPrompts(fx, { clusterId: f.id, edits, role: fx.member.role }));
    if (r && !r.ok) console.warn(`[app] fixture cluster edit refused: ${r.message}`);
    return r?.ok ? back("saved") : back("refused", r?.message);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const r = await editPrompts(supabaseAdmin(), { clientId: client.id, clusterId: f.id, edits, role: writeRole(client) });
  if (!r.ok) {
    console.warn(`[app] cluster edit refused: ${r.message}`);
    return back("refused", r.message);
  }
  return back("saved");
}
