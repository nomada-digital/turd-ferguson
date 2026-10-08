import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureGroup } from "@/lib/tracking/fixture-writes";
import { moveIntoCluster } from "@/lib/tracking/limits";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { slotWhyOf } from "@/lib/tracking/slot";
import { BULK_ID, type StopDone, readBulkIds, readStopForm, stopReturn } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,64}$/;

/**
 * "Move into a cluster" - R170 part 2 (Danny, 2 Oct 2026, danny.md line 180).
 * Posted by the plain HTML form on each ungrouped prompt on the Clusters page:
 * the prompt and the page state in the action's query string, as the stop
 * route reads them, and the picked cluster in the body. The rules and the
 * write are limits.ts's moveIntoCluster (refuseGrouping). Session and
 * membership as the stop route; the fixture writes nothing unless
 * TRACKING_FIXTURE_WRITE=1 (R168) holds it in memory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const f = readStopForm((k) => sp.get(k), APP_LIMITS.search);
  const form = await req.formData().catch(() => null);
  const clusterId = typeof form?.get("cluster") === "string" ? (form.get("cluster") as string) : "";
  if (!f || f.kind !== "prompt" || f.undo) return NextResponse.json({ error: "Not a move this page can make." }, { status: 400 });
  // DS13: the Ungrouped bulk form posts id=selected and the ticked prompts as `ids`; each is moved, and judged, on its own, in order.
  const bulk = f.id === BULK_ID;
  const ids = bulk ? readBulkIds(form?.getAll("ids") ?? []) : [f.id];
  // R151 (3 Oct 2026): a refusal carries its code (slot.ts SLOT_WHY), so the toast says why - for a batch only when none
  // moved, from the last refusal; a batch that partly moved keeps its counts.
  let why = "";
  const back = (done: StopDone, n = 0) => NextResponse.redirect(dashUrl(req, stopReturn(slug, f, done, bulk ? { n, of: ids.length } : undefined, slotWhyOf(why))), 303);
  // The bulk bar's cluster pick cannot be `required` - its Stop button shares the form - so a missing pick comes back as a toast.
  if (bulk && (!ids.length || !ID.test(clusterId))) return back("unselected");
  if (!ID.test(clusterId)) return NextResponse.json({ error: "Not a move this page can make." }, { status: 400 });
  let n = 0;
  if (fixtureMode()) {
    for (const id of ids) {
      const r = writeFixture((fx) => fixtureGroup(fx, { clusterId, id, role: fx.member.role }));
      if (r?.ok) n++;
      else if (r) {
        console.warn(`[app] fixture move refused: ${r.message}`);
        why = r.message;
      }
    }
    return back(n ? "moved" : "refused", n);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  for (const id of ids) {
    const r = await moveIntoCluster(supabaseAdmin(), { clientId: client.id, clusterId, id, role: writeRole(client) });
    if (r.ok) n++;
    else {
      console.warn(`[app] move refused: ${r.message}`);
      why = r.message;
    }
  }
  return back(n ? "moved" : "refused", n);
}
