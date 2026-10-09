import { NextResponse } from "next/server";

import { invite as inviteEmail } from "@/lib/email/lifecycle";
import { lifecycleOn } from "@/lib/email/lifecycle-mail";
import { siteUrl } from "@/lib/scan/verify-email";
import { appUrl } from "@/lib/app-host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TIER_PLAIN, type TierKey } from "@/lib/tier-text";
import { upsellMode } from "@/lib/tracking/ask";
import { trackingDay } from "@/lib/tracking/decide";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { fixtureTeam } from "@/lib/tracking/fixture-writes";
import { sendInvite } from "@/lib/tracking/invite-mail";
import { clientsFor, sessionEmail } from "@/lib/tracking/member";
import { writeFixture } from "@/lib/tracking/repo";
import { readKept } from "@/lib/tracking/stop";
import { type TeamDone, type TeamWhy, changeRole, invite, inviteMail, inviteScope, invitesToday, onClient, readTeam, readTeamForm, refuseActor, refuseChange, refuseInvite, removeMember, teamReturn, teamWhy } from "@/lib/tracking/team";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invite, change a role, remove - R142 part 2 (1 Oct 2026; BRIEF-4 P2 Team).
 * Posted by plain HTML forms on Settings, so it works with JS off; the answer
 * is a 303 back to the page with the toast in the URL. Session and membership
 * as the stop route; owners only. The rules are team.ts; the invite mail is
 * invite-mail.ts. The fixture is read-only unless TRACKING_FIXTURE_WRITE=1
 * (R168), which holds the change in memory; on the fixture nothing is sent.
 *
 * AG-1 (9 Oct 2026): every rule runs on the members who see this client
 * (onClient), and the invite is to this client only or to every client on the
 * account (inviteScope, scope.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ client: string }> }) {
  const { client: slug } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const f = form ? readTeamForm((k) => form.get(k)) : null;
  // DS40: the form's action carries the page's stated range; only from, to and compare come back.
  const sp = new URL(req.url).searchParams;
  const kept = readKept((k) => sp.get(k), 0);
  const back = (done: TeamDone, why: TeamWhy | null = null) => NextResponse.redirect(dashUrl(req, teamReturn(slug, done, f?.email ?? null, kept, why)), 303);
  // R151 (3 Oct 2026): an invite whose address fails the shape check says so on its field.
  if (!f) return back("refused", form?.get("op") === "invite" ? "email" : null);
  if (fixtureMode()) {
    // R168: invite, role and remove held in memory on the writable fixture; sendInvite is never reached here.
    const r = writeFixture((fx) => fixtureTeam(fx, { op: f.op, email: f.email, role: f.role, scope: f.scope, slug, now: new Date().toISOString() }));
    if (r && !r.ok) console.warn(`[app] fixture team ${f.op} refused: ${r.message}`);
    return r?.ok ? back(f.op === "invite" ? "invited" : f.op === "role" ? "role" : "removed") : back("refused", r ? teamWhy(r.message) : null);
  }

  const email = await sessionEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login")), 303);
  const client = (await clientsFor(email)).find((c) => c.slug === slug);
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const refused = (why: string) => {
    console.warn(`[app] team ${f.op} refused: ${why}`);
    // A rule's refusal carries its code; a failed read or write does not, and reads "Reload the page".
    return back("refused", teamWhy(why));
  };
  const actor = refuseActor(client.role);
  if (actor) return refused(actor);

  const db = supabaseAdmin();
  // The account is read here, server-side only; clientsFor keeps account_id out of what pages get.
  const { data: row, error: rowErr } = await db.from("client_domains").select("account_id").eq("id", client.id).maybeSingle();
  if (rowErr || !row) return refused(`could not read the client's account: ${rowErr?.message ?? "none"}`);
  const accountId = row.account_id as string;
  const team = await readTeam(db, accountId);
  if (typeof team === "string") return refused(team);
  // AG-1: only the members who see this client are its team here; the count decides whether the invite asks.
  const rows = onClient(team.rows, client.id);
  const { count: accountClients, error: nErr } = await db.from("client_domains").select("id", { count: "exact", head: true }).eq("account_id", accountId).not("slug", "is", null);
  if (nErr || accountClients === null) return refused(`could not count the account's clients: ${nErr?.message ?? "no count"}`);

  if (f.op === "invite") {
    const scope = inviteScope(f.scope, accountClients);
    // Before 20261009010000 is applied there is nowhere to write one client; Settings then offers every client only.
    if (scope === "client" && !team.scoping) return refused("an invite to one client needs dashboard_member_clients, which is not there yet");
    const today = trackingDay();
    const n = await invitesToday(db, { email, today });
    if (typeof n === "string") return refused(n);
    const no = refuseInvite({ rows, email: f.email, invitesToday: n });
    if (no) return refused(no);
    // Read before the write: agency mode must be known, or the mail could name a nomada tier.
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", accountId).maybeSingle();
    if (aErr || !account) return refused(`could not read the account: ${aErr?.message ?? "none"}`);
    const elsewhere = team.rows.find((r) => r.email === f.email) ?? null;
    const r = await invite(db, { accountId, clientId: client.id, email: f.email, role: f.role!, by: email, scope, elsewhere });
    if (!r.ok) return refused(r.message);
    const agency = upsellMode(account.upsell_mode) === "agency";
    // The mail says when they will see every client; an invite to one client names that client only.
    const everyClient = scope === "account" && accountClients > 1 ? accountClients : null;
    // The branded invite (R159) names alwayscited and the tier, so never in agency mode; off until its flag is on.
    const mail =
      !agency && (await lifecycleOn(db, "invite"))
        ? inviteEmail({ tier: (client.tier in TIER_PLAIN ? client.tier : "tracked") as TierKey, domain: client.domain, link: appUrl("/login", siteUrl()), inviter: email, role: f.role!, everyClient })
        : inviteMail({ inviter: email, domain: client.domain, role: f.role!, agency, everyClient });
    if (!(await sendInvite({ to: f.email, replyTo: email, ...mail }))) console.warn("[app] invite saved but the mail was not sent");
    return back("invited");
  }

  const no = refuseChange({ rows, actor: email, email: f.email, op: f.op, role: f.role });
  if (no) return refused(no);
  const target = rows.find((r) => r.email === f.email)!;
  const r =
    f.op === "role"
      ? await changeRole(db, { accountId, email: f.email, role: f.role! })
      : await removeMember(db, { accountId, email: f.email, by: email, clientId: client.id, row: target });
  if (!r.ok) return refused(r.message);
  return back(f.op === "role" ? "role" : "removed");
}
