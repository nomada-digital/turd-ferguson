import "server-only";

import type { TrialRepeat } from "@/config/trial";
import { normalizeDomain } from "@/lib/scan/domain";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * One trial per client domain and per email, ever (Danny, 8 Oct 2026).
 *
 * An email with any order before, or a domain with any client before, has been
 * through alwayscited already - as a trial, a paid plan or a pilot - so the
 * order goes ahead paid from day one, with a line on Stripe's form saying why.
 * Read only while the trial is on, so a dark trial costs checkout nothing.
 *
 * Throws when a read fails: checkout then answers "did not open, try again"
 * rather than guessing either way about somebody's first charge.
 */
export async function readTrialRepeat(p: { email: string; website: string; scan: string }): Promise<TrialRepeat> {
  const db = supabaseAdmin();
  const email = p.email.trim().toLowerCase();

  // Exact (audit security-1/-3): ilike let `%@rival.com` ask whether anyone at a company had ordered.
  const { data: order, error: oErr } = await db.from("orders").select("stripe_session_id").eq("email", email).limit(1);
  if (oErr) throw new Error(`could not read orders: ${oErr.message}`);
  if (order?.length) return "email";

  let domain = p.website ? normalizeDomain(p.website) : "";
  if (!domain && /^[0-9a-f]{32}$/i.test(p.scan)) {
    const { data: scan, error: sErr } = await db.from("scans").select("domain").eq("public_token", p.scan.toLowerCase()).maybeSingle();
    if (sErr) throw new Error(`could not read the scan: ${sErr.message}`);
    domain = (scan?.domain as string | undefined) ?? "";
  }
  if (!domain) return null;

  const { data: client, error: cErr } = await db.from("client_domains").select("id").eq("domain", domain).limit(1);
  if (cErr) throw new Error(`could not read clients: ${cErr.message}`);
  return client?.length ? "domain" : null;
}
