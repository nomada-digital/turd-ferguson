import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";
import { safeNext } from "@/lib/tracking/next-path";
import { loadSetupConfirmed } from "@/lib/tracking/setup-data";
import { landingAfterAuth, needsSetup } from "@/lib/tracking/setup-landing";
import { SESSION_TTL_MS, hashToken, isTokenShape, newToken, sessionCookie } from "@/lib/tracking/session";
import { dashPath, dashUrl } from "@/lib/tracking/app-redirect";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consume a login link and start a session (T3, 29 Sep 2026).
 *
 * A POST from the button on /app/auth rather than the GET of the link itself:
 * mail scanners fetch links on delivery, and a single-use token consumed by a
 * GET would be spent by the scanner before its owner clicked it - the lesson
 * the deleted verify link left in paid-get.test.mts.
 *
 * The claim is a compare-and-swap - `used_at is null` and unexpired, in the
 * filter - so a link works once however many times it is posted.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  if (!isTokenShape(token)) return NextResponse.redirect(dashUrl(req, dashPath(req, "/login?link=expired")), 303);
  // R163: back to the link's own page, which reads the token and says spent
  // (with a one-click new link) or, with failed=1, shows the button rather
  // than submitting itself again.
  const next = safeNext(form?.get("next"));
  const back = next ? `&next=${encodeURIComponent(next)}` : "";
  const failed = NextResponse.redirect(dashUrl(req, appPath(`/auth?token=${token}&failed=1${back}`)), 303);

  const db = supabaseAdmin();
  const { data: claimed, error } = await db
    .from("dashboard_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("email");
  if (error) {
    console.warn(`[app] could not claim a login token: ${error.message}`);
    return failed;
  }
  const email = claimed?.[0]?.email as string | undefined;
  if (!email) return failed;

  const session = newToken();
  const { error: sErr } = await db.from("dashboard_sessions").insert({
    token_hash: hashToken(session),
    email,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  if (sErr) {
    console.warn(`[app] could not start a session: ${sErr.message}`);
    return failed;
  }

  // BRIEF-4 P0: Settings' "Last signed in". Never fatal - the session is already started.
  const { error: lErr } = await db
    .from("dashboard_members")
    .update({ last_login_at: new Date().toISOString() })
    .eq("email", email)
    .is("removed_at", null);
  if (lErr) console.warn(`[app] could not record the sign-in: ${lErr.message}`);

  // R163: straight to the client's dashboard, not /app and a second redirect.
  // A failed read falls back to /app, which makes the same choice.
  // R164: a safe next wins; its own page checks membership as every /app page does.
  // R166 part 3c: ahead of next, a first client bought since the setup page
  // (needsSetup) lands on its setup until confirmed. A failed setup read
  // counts as confirmed, so a set-up client is never sent round again.
  const listed = await clientsFor(email).catch(() => null);
  const first = listed?.[0];
  const unconfirmed = first && needsSetup(first) ? (await loadSetupConfirmed(first.id)) === false : false;
  const clients = listed ? listed.map((c, i) => ({ slug: c.slug, confirmed: !(i === 0 && unconfirmed) })) : null;
  const to = landingAfterAuth({ next, clients });
  const res = NextResponse.redirect(dashUrl(req, to), 303);
  res.cookies.set(sessionCookie(session));
  return res;
}
