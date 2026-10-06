import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCheck } from "@/lib/tracking/add-cluster";
import { ADMIN_LIMITS, trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureAddCluster } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { addCluster } from "@/lib/tracking/new-cluster";
import { writeFixture } from "@/lib/tracking/repo";
import { slotWhyOf } from "@/lib/tracking/slot";
import { readKept } from "@/lib/tracking/stop";
import { recordUsage } from "@/lib/tracking/usage-record";
import { dashPath } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Start tracking this cluster" - BRIEF-3 T6 part 3c (30 Sep 2026). Posted by
 * step 2 of the Add panel: the keyword, its checked volume and intent with the
 * signature Check keyword gave them, and the five prompts p-0 to p-4. No paid
 * read: a verdict whose signature does not verify for this client and today
 * is refused, so the check cannot be skipped. The writes are new-cluster.ts
 * through limits.ts. Session and membership as the stop route; the fixture
 * writes nothing unless TRACKING_FIXTURE_WRITE=1 (R168) holds it in memory.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const page = appPath(`/${encodeURIComponent(slug)}/clusters`);
  // DS15 (2 Oct 2026): the Add panel's action carries the page's range, filter and search; the toast's keys win.
  const view = readKept((k) => new URL(req.url).searchParams.get(k), APP_LIMITS.search);
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`${page}?${new URLSearchParams({ ...view, ...q })}`, req.url), 303);
  // R151 (3 Oct 2026): a rule's refusal carries its code (slot.ts SLOT_WHY); a failed read or write keeps the Reload line.
  const refused = (message = "") => {
    const why = slotWhyOf(message);
    return back({ done: "refused", kind: "cluster", id: "new", ...(why ? { why } : {}) });
  };
  const form = await req.formData().catch(() => null);
  const field = (k: string) => (typeof form?.get(k) === "string" ? (form.get(k) as string).slice(0, ADMIN_LIMITS.question) : "");
  const keyword = field("keyword");
  const volume = Number(field("vol"));
  const intent = field("intent");
  const prompts = [0, 1, 2, 3, 4].map((i) => field(`p-${i}`));
  if (fixtureMode()) {
    // R168: on the writable fixture the cluster is held in memory, verified against the fixture's own check signature.
    const r = writeFixture((fx) => fixtureAddCluster(fx, { keyword, volume, intent, sig: field("sig") || null, prompts, role: fx.member.role }));
    if (r && !r.ok) console.warn(`[app] fixture add cluster refused: ${r.message}`);
    return r?.ok && r.id ? back({ done: "added", kind: "cluster", id: r.id, open: r.id }) : refused(r && !r.ok ? r.message : "");
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(new URL(dashPath(req, "/login"), req.url), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const day = trackingDay();
  if (!verifyCheck({ clientId: client.id, keyword, volume, intent, day }, field("sig") || null, process.env.CRON_SECRET ?? "")) {
    console.warn("[app] add cluster refused: the keyword check did not verify");
    return refused("The keyword check did not verify.");
  }
  const r = await addCluster(supabaseAdmin(), {
    clientId: client.id,
    tier: client.tier,
    keyword,
    volume,
    intent,
    prompts,
    today: day,
    by: email,
    role: client.role,
  });
  if (!r.ok) {
    console.warn(`[app] add cluster refused: ${r.message}`);
    return refused(r.message);
  }
  await recordUsage(supabaseAdmin(), { clientId: client.id, email, event: "add_save", path: "/clusters", today: day });
  return back({ done: "added", kind: "cluster", id: r.clusterId, open: r.clusterId });
}
