import { NextResponse } from "next/server";

import { APP_LIMITS } from "@/config/contact";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCheck } from "@/lib/tracking/add-cluster";
import { ADMIN_LIMITS, trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureRekey } from "@/lib/tracking/fixture-writes";
import { clientsFor, sessionEmail, writeRole } from "@/lib/tracking/member";
import { changeKeyword } from "@/lib/tracking/rekey";
import { writeFixture } from "@/lib/tracking/repo";
import { type StopDone, readStopForm, stopReturn } from "@/lib/tracking/stop";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Use this keyword" - R179 (Danny, 2 Oct 2026, danny.md line 211). Posted by
 * a pending cluster's Change keyword on the Clusters page, and by a setup
 * card, once Check keyword has passed: the cluster and page state in the
 * action's query string as the stop route reads them, the checked keyword,
 * volume, intent and signature in the body. No paid read - a verdict whose
 * signature does not verify for this client and today is refused, as the
 * cluster route does. The rules and the write are rekey.ts. `to=setup` sends
 * the 303 back to the setup card instead of Clusters.
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const f = readStopForm((k) => sp.get(k), APP_LIMITS.search);
  if (!f || f.kind !== "cluster" || f.undo) return NextResponse.json({ error: "Not a change this page can make." }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const field = (k: string) => (typeof form?.get(k) === "string" ? (form.get(k) as string).slice(0, ADMIN_LIMITS.question) : "");
  const keyword = field("keyword");
  const volume = Number(field("vol"));
  const intent = field("intent");
  const sig = field("sig") || null;
  const setup = sp.get("to") === "setup";
  const back = (done: StopDone) => {
    const to = setup
      ? // R151 (3 Oct 2026): a refusal drops the fragment so the card's field can take focus (a fragment target stops autofocus).
        appPath(`/${encodeURIComponent(slug)}/setup?${new URLSearchParams({ card: f.id, rekey: done })}${done === "refused" ? "" : `#card-${encodeURIComponent(f.id)}`}`)
      : stopReturn(slug, { ...f, back: { ...f.back, open: f.id } }, done);
    return NextResponse.redirect(dashUrl(req, to), 303);
  };
  if (fixtureMode()) {
    // R168: on the writable fixture the change is held in memory, verified against the fixture's own check signature.
    const r = writeFixture((fx) => fixtureRekey(fx, { clusterId: f.id, keyword, volume, intent, sig, role: fx.member.role }));
    if (r && !r.ok) console.warn(`[app] fixture keyword change refused: ${r.message}`);
    return back(r?.ok ? "rekeyed" : "refused");
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const day = trackingDay();
  if (!verifyCheck({ clientId: client.id, keyword, volume, intent, day }, sig, process.env.CRON_SECRET ?? "")) {
    console.warn("[app] keyword change refused: the keyword check did not verify");
    return back("refused");
  }
  const r = await changeKeyword(supabaseAdmin(), { clientId: client.id, clusterId: f.id, keyword, volume, intent, today: day, role: writeRole(client), by: email });
  if (!r.ok) {
    console.warn(`[app] keyword change refused: ${r.message}`);
    return back("refused");
  }
  return back("rekeyed");
}
