import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { SESSION_COOKIE, hashToken, isTokenShape } from "@/lib/tracking/session";
import { appPath } from "@/lib/app-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * End a dashboard session (T3, 29 Sep 2026). The row is expired rather than
 * deleted, and the cookie cleared; the redirect goes to the login page either way.
 * With `everywhere=1` (Settings' "Sign out of every device", R142 part 3,
 * 1 Oct 2026; BRIEF-4 P2) every live session of this session's email is
 * expired too - the email is read off this session's own row, never the form.
 */
export async function POST(req: Request) {
  const raw = req.headers.get("cookie") ?? "";
  const token = raw
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const form = await req.formData().catch(() => null);
  const everywhere = form?.get("everywhere") === "1";
  if (isTokenShape(token)) {
    const db = supabaseAdmin();
    const now = new Date().toISOString();
    const hash = hashToken(token);
    if (everywhere) {
      const { data, error: readErr } = await db.from("dashboard_sessions").select("email").eq("token_hash", hash).gt("expires_at", now).limit(1);
      const email = (data?.[0]?.email as string | undefined) ?? null;
      if (readErr) console.warn(`[app] could not read the session to sign out everywhere: ${readErr.message}`);
      if (email) {
        const { error } = await db.from("dashboard_sessions").update({ expires_at: now }).eq("email", email).gt("expires_at", now);
        if (error) console.warn(`[app] could not end every session: ${error.message}`);
      }
    }
    const { error } = await db.from("dashboard_sessions").update({ expires_at: now }).eq("token_hash", hash);
    if (error) console.warn(`[app] could not end a session: ${error.message}`);
  }
  // DS7 (2 Oct 2026, R172 pass 1): the login page says which sign-out happened.
  const res = NextResponse.redirect(new URL(appPath(`/login?out=${everywhere ? "all" : "1"}`), req.url), 303);
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
  return res;
}
