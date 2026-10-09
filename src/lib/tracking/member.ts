import "server-only";

import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { PAYMENT_BANNER_READ, type PaymentView, withPayment } from "@/lib/checkout/payment";

import { readScopes, visibleClients } from "./scope.ts";
import { SESSION_COOKIE, hashToken, isTokenShape } from "./session.ts";

/**
 * Who is looking at /app, and which clients they may see (T3, 29 Sep 2026).
 * A member sees the clients on the accounts they belong to - every one, or,
 * since AG-1 (9 Oct 2026, scope.ts), only those their scope lists. Every /app
 * page and route finds its client in this list, so a client outside it is a
 * 404 and is never in the switcher.
 */

export type MemberClient = {
  id: string;
  slug: string;
  domain: string;
  brand: string | null;
  market: string;
  tier: string;
  started_on: string | null;
  question_limit: number;
  keyword_limit: number;
  /** BRIEF-3 C2: 10 plus 5 per pack, set by the webhook only. Absent in fixtures cut before clusters. */
  cluster_limit?: number;
  /** The alwaystracked trial (8 Oct 2026): when it ends, and when an owner cancelled it. Absent in fixtures. */
  trial_ends_at?: string | null;
  trial_cancelled_at?: string | null;
  /** client_domains.status: active, paused or ended (a cancelled subscription ends it). Absent in older fixtures. */
  status?: string;
} & Partial<PaymentView>;

/** The signed-in email, or null. */
export async function sessionEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isTokenShape(token)) return null;
  const { data, error } = await supabaseAdmin()
    .from("dashboard_sessions")
    .select("email")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw new Error(`could not read the session: ${error.message}`);
  return (data?.[0]?.email as string | undefined) ?? null;
}

/** Every client this email may see, oldest first, with the member's role on it. */
export async function clientsFor(email: string): Promise<(MemberClient & { role: string })[]> {
  const db = supabaseAdmin();
  const { data: memberships, error: mErr } = await db.from("dashboard_members").select("id, account_id, role").eq("email", email).is("removed_at", null);
  if (mErr) throw new Error(`could not read memberships: ${mErr.message}`);
  const mine = (memberships ?? []).map((m) => ({ id: m.id as string, account_id: m.account_id as string, role: m.role as string }));
  if (!mine.length) return [];
  // AG-1: a failed scope read throws here rather than reading as every client.
  const scopes = await readScopes(db, mine.map((m) => m.id));
  const { data: rows, error: cErr } = await db
    .from("client_domains")
    .select("id, account_id, slug, domain, brand_name, market, tier, started_on, question_limit, keyword_limit, cluster_limit, trial_ends_at, trial_cancelled_at, status")
    .in("account_id", [...new Set(mine.map((m) => m.account_id))])
    .not("slug", "is", null)
    .order("created_at", { ascending: true });
  if (cErr) throw new Error(`could not read clients: ${cErr.message}`);
  // Named fields only: account_id is used for the join and never returned (AG-1 scope, then BL-2's payment read below).
  const clients = visibleClients(mine, scopes.of, (rows ?? []) as { id: string; account_id: string; [k: string]: unknown }[]).map(({ client: r, role }) => ({
    id: r.id,
    slug: r.slug as string,
    domain: r.domain as string,
    brand: r.brand_name as string | null,
    market: r.market as string,
    tier: r.tier as string,
    started_on: r.started_on as string | null,
    question_limit: r.question_limit as number,
    keyword_limit: r.keyword_limit as number,
    cluster_limit: r.cluster_limit as number,
    trial_ends_at: (r.trial_ends_at as string | null) ?? null,
    trial_cancelled_at: (r.trial_cancelled_at as string | null) ?? null,
    status: (r.status as string | null) ?? "active",
    role,
  }));
  // BL-2 (9 Oct 2026): the payment banner's columns, read on their own so a
  // failure here - 20261009030000 not applied, or anything else - costs the
  // banner and never the dashboard (payment.ts withPayment).
  if (!clients.length) return clients;
  const { data: paid, error: pErr } = await db.from("client_domains").select(PAYMENT_BANNER_READ).in("id", clients.map((c) => c.id));
  if (pErr) console.warn(`[app] payment state not read, no payment banner: ${pErr.message}`);
  return withPayment(clients, pErr ? null : ((paid ?? []) as Record<string, unknown>[]));
}

/**
 * The role a write is judged with (8 Oct 2026, review of 2379757). An ended
 * client's history stays readable, but nothing new is tracked for it - the
 * runner skips it - so adding or editing clusters, prompts and keywords would
 * promise a check that never comes. It is read-only to everyone, which the
 * routes' existing viewer refusals and the pages' canWrite already enforce.
 */
export function writeRole(c: { role: string; status?: string }): string {
  return c.status === "ended" ? "viewer" : c.role;
}
