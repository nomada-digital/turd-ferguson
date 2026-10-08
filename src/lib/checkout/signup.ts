import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { siteUrl } from "@/lib/scan/verify-email";
import { appUrl } from "@/lib/app-host";
import { sendOrderEmail } from "@/lib/checkout/order-mail";
import { clustersToMake, orderEmailText, orderRow, packsOn, signupResume, subscriptionScanToken, trialConverted, type CompletedOrder } from "@/lib/checkout/webhook";
import { readSubscription } from "@/lib/checkout/stripe";
import { TRACKED_PRICE } from "@/config/pricing";
import { trialCharge, trialMoment } from "@/config/trial";
import { dayAfter, slugFor, trackingDay } from "@/lib/tracking/decide";
import { angleFor, clusterLimitFor, insertCluster, insertKeyword, insertPrompts, namesBrandIn, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { planEnded, welcome } from "@/lib/email/lifecycle";
import { lifecycleOn, sendLifecycle } from "@/lib/email/lifecycle-mail";
import type { TierKey } from "@/lib/tier-text";
import { sendLoginLink } from "@/lib/tracking/login-mail";
import { LOGIN_TTL_MS, hashToken, newToken } from "@/lib/tracking/session";

/**
 * What the Stripe webhook writes (BRIEF-3 C4, 30 Sep 2026). Each returns
 * false only when Stripe should retry; the route then forgets the event id.
 *
 * checkout.session.completed with a scan token: the account by email, the
 * client from the scan at the tier bought, the first cluster from the scan's
 * keyword and its first five prompts (or "Needs a keyword" when the scan chose
 * none, R117), the buyer as owner, and a login link. Without a scan, the same
 * from the website the order carries (R158, clientFromOrder below).
 * One public.orders row per Session either way, keyed on its id so a replay
 * writes nothing; a refused row is logged and named in the order email, never
 * a retry, because the client above is already made. The order email goes to
 * Danny either way (pricing spec section 5).
 */

export const NEEDS_A_KEYWORD = "Needs a keyword";
const TIERS = ["tracked", "mentioned", "cited"];

type Scan = {
  id: string;
  domain: string;
  brand_name: string | null;
  topic: string | null;
  market: string;
  cluster_keyword: string | null;
  cluster_keyword_volume: number | null;
  cluster_keyword_intent: string | null;
  cluster_keyword_status: string | null;
};

/**
 * Any paid order gets its account, client, clusters, owner and login link
 * (R158, Danny, 1 Oct 2026, danny.md 168): from the scan when the order
 * carries one, else from the website /checkout asked for. A scan only
 * prefills cluster 1; every other cluster bought starts "Needs a keyword".
 * Before this an order without a scan built nothing and the buyer heard nothing.
 */
async function clientFromOrder(db: SupabaseClient, o: CompletedOrder): Promise<{ ok: boolean; outcome: string; clientId?: string }> {
  if (!o.email) return { ok: true, outcome: "no buyer email on the Session, so no client was created" };
  const tier = TIERS.includes(o.tier) ? o.tier : "tracked";

  let scan: Scan | null = null;
  if (o.scanToken) {
    const { data, error: sErr } = await db
      .from("scans")
      .select("id, domain, brand_name, topic, market, status, cluster_keyword, cluster_keyword_volume, cluster_keyword_intent, cluster_keyword_status")
      .eq("public_token", o.scanToken)
      .maybeSingle();
    if (sErr) return { ok: false, outcome: `could not read the scan: ${sErr.message}` };
    if (data && data.status === "complete" && (data.market === "UK" || data.market === "US")) scan = data as Scan;
  }
  const market = scan ? scan.market : o.market === "uk" ? "UK" : o.market === "us" ? "US" : null;
  const domain = scan ? scan.domain : o.website;
  if (!domain || !market) {
    return {
      ok: true,
      outcome: o.scanToken
        ? "the scan on the order is missing, unfinished or has no market, so no client was created"
        : "no scan and no website on the order, so no client was created",
    };
  }

  // Exact, never ilike (8 Oct 2026, audit security-1): ILIKE reads `_` and `%`
  // as wildcards, so a buyer could be made owner of a stranger's account.
  // o.email is lowercased in completedOrder, and stored emails are lowercase.
  const { data: found, error: aErr } = await db.from("accounts").select("id").eq("email", o.email).maybeSingle();
  if (aErr) return { ok: false, outcome: `could not read accounts: ${aErr.message}` };
  let accountId = found?.id as string | undefined;
  if (!accountId) {
    const { data: made, error: mErr } = await db.from("accounts").insert({ email: o.email }).select("id").single();
    if (mErr) return { ok: false, outcome: `could not create the account: ${mErr.message}` };
    accountId = made.id as string;
  }

  const startedOn = dayAfter(trackingDay());
  const clientRow = {
    account_id: accountId,
    domain,
    brand_name: scan?.brand_name ?? null,
    topic: scan?.topic ?? null,
    market,
    slug: slugFor(domain),
    status: "active",
    tier,
    started_on: startedOn,
    source_scan_id: scan?.id ?? null,
  };
  let clientId: string;
  if (clientRow.topic !== null) {
    const { data: client, error: cErr } = await db.from("client_domains").upsert(clientRow, { onConflict: "account_id,domain,topic,market" }).select("id").single();
    if (cErr) return { ok: false, outcome: `could not create the client: ${cErr.message}` };
    clientId = client.id as string;
  } else {
    // A null topic never conflicts in a unique index (nulls are distinct), so a
    // retry would make a second client: look for the first one instead.
    const { data: had, error: hErr } = await db
      .from("client_domains")
      .select("id")
      .eq("account_id", accountId)
      .eq("domain", domain)
      .eq("market", market)
      .is("topic", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (hErr) return { ok: false, outcome: `could not read the client: ${hErr.message}` };
    if (had?.[0]) clientId = had[0].id as string;
    else {
      const { data: client, error: cErr } = await db.from("client_domains").insert(clientRow).select("id").single();
      if (cErr) return { ok: false, outcome: `could not create the client: ${cErr.message}` };
      clientId = client.id as string;
    }
  }

  const chosen = scan?.cluster_keyword_status === "chosen" && typeof scan.cluster_keyword === "string" && scan.cluster_keyword.trim();
  const clusterName = chosen ? (scan!.cluster_keyword as string).trim() : NEEDS_A_KEYWORD;

  // A Stripe retry of a signup that failed part way picks up where it stopped (signupResume).
  const { data: prior, error: pErr } = await db
    .from("tracked_clusters")
    .select("id, keyword_id")
    .eq("client_domain_id", clientId)
    .eq("name", clusterName)
    .is("stopped_on", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (pErr) return { ok: false, outcome: `could not read the client's clusters: ${pErr.message}`, clientId };
  let existing: Parameters<typeof signupResume>[0] = null;
  if (prior?.[0]) {
    const { count, error: nErr } = await db.from("tracked_questions").select("id", { count: "exact", head: true }).eq("cluster_id", prior[0].id).is("stopped_on", null);
    if (nErr) return { ok: false, outcome: `could not count the cluster's prompts: ${nErr.message}`, clientId };
    existing = { id: prior[0].id as string, keywordId: (prior[0].keyword_id as string | null) ?? null, livePrompts: count ?? 0 };
  }
  const resume = signupResume(existing);

  let clusterId = resume.clusterId;
  if (!clusterId) {
    const cluster = await insertCluster(db, clientId, { name: clusterName, tier, started_on: startedOn });
    if (!cluster.ok) return { ok: false, outcome: `client made, cluster refused: ${cluster.message}`, clientId };
    clusterId = cluster.ids[0]!;
  }
  if (chosen && resume.keyword) {
    const kw = await insertKeyword(db, clientId, clusterId, {
      keyword: (scan!.cluster_keyword as string).trim(),
      added_on: startedOn,
      added_by: "nomada",
      search_volume: scan!.cluster_keyword_volume ?? null,
      intent: scan!.cluster_keyword_intent ?? null,
    });
    if (!kw.ok) return { ok: false, outcome: `cluster made, keyword refused: ${kw.message}`, clientId };
  }

  let rows: { text: string; angle: string | null; source: string; added_on: string; added_by: string }[] = [];
  if (scan) {
    const { data: sq, error: qErr } = await db.from("scan_questions").select("idx, question, kind").eq("scan_id", scan.id).order("idx", { ascending: true });
    if (qErr) return { ok: false, outcome: `could not read the scan's prompts: ${qErr.message}`, clientId };
    // Each prompt keeps its scan kind as its angle (BRIEF-3 C3).
    rows = (sq ?? [])
      .map((q) => ({ text: String(q.question).trim(), angle: angleFor(q.kind) }))
      // A scan prompt naming the brand is left behind: this copies the scan, which measures unprompted naming (R133, limits.ts).
      .filter((q) => q.text.length >= 8 && q.text.length <= 300 && !namesBrandIn(q.text, { brand: scan.brand_name, domain: scan.domain }))
      .slice(0, PROMPTS_PER_CLUSTER)
      .map((q) => ({ text: q.text, angle: q.angle, source: "scan", added_on: startedOn, added_by: "nomada" }));
    const prompts = resume.prompts ? await insertPrompts(db, clientId, clusterId, rows) : ({ ok: true } as const);
    if (!prompts.ok) return { ok: false, outcome: `cluster made, prompts refused: ${prompts.message}`, clientId };
  }

  // Every other cluster bought starts "Needs a keyword" (R158); a retry makes only the missing ones.
  const { data: live, error: lErr } = await db.from("tracked_clusters").select("name").eq("client_domain_id", clientId).is("stopped_on", null);
  if (lErr) return { ok: false, outcome: `could not read the client's clusters: ${lErr.message}`, clientId };
  const missing = clustersToMake(tier === "tracked" ? 1 : o.quantity, clusterName, NEEDS_A_KEYWORD, (live ?? []).map((c) => String(c.name)));
  for (const name of missing) {
    const made = await insertCluster(db, clientId, { name, tier, started_on: startedOn });
    if (!made.ok) return { ok: false, outcome: `client made, cluster refused: ${made.message}`, clientId };
  }
  const clusters = tier === "tracked" ? 1 : Math.max(1, o.quantity);

  const { error: memErr } = await db
    .from("dashboard_members")
    .upsert({ account_id: accountId, email: o.email, role: "owner" }, { onConflict: "account_id,email", ignoreDuplicates: true });
  if (memErr) return { ok: false, outcome: `client made, owner not added: ${memErr.message}`, clientId };

  // The login link, the same token row /api/app/login writes; sent to the member just stored.
  const token = newToken();
  const { error: tErr } = await db
    .from("dashboard_login_tokens")
    .insert({ token_hash: hashToken(token), email: o.email, ip_hash: null, expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString(), used_at: null });
  // The welcome replaces the bare link only once its flag is on (R159; off until Danny approves it).
  const link = appUrl(`/auth?token=${token}`, siteUrl());
  const welcomeOn = !tErr && (await lifecycleOn(db, "welcome"));
  const sent =
    !tErr &&
    (welcomeOn
      ? await sendLifecycle({ memberEmail: o.email, mail: welcome({ tier: tier as TierKey, clusters, domain, link }) })
      : await sendLoginLink({ memberEmail: o.email, link }));

  return {
    ok: true,
    clientId,
    outcome:
      `${scan ? "from the scan" : "no scan, from the website on the order"}: ${domain} at ${tier}, first check ${startedOn}; ` +
      `cluster 1 "${clusterName}" with ${rows.length} prompt(s)${clusters > 1 ? `, ${clusters - 1} more "${NEEDS_A_KEYWORD}"` : ""}` +
      `${chosen && rows.length && clusters === 1 ? "" : " - pick keywords and prompts in /admin/tracking"}; ${o.email} is owner; ${welcomeOn ? "welcome email" : "login link"} ${sent ? "sent" : "NOT sent"}.`,
  };
}

/**
 * When a trialing order's first charge is due (Danny, 8 Oct 2026): Stripe's own
 * trial_end, read off the subscription, so the date is the one Stripe charges
 * on. If the read fails the trial's length from now stands in, logged - the
 * signup is not held up for a date.
 */
async function trialEndOf(o: CompletedOrder): Promise<string | null> {
  if (!o.trialDays) return null;
  if (o.subscriptionId) {
    const sub = await readSubscription(o.subscriptionId);
    if (sub.ok && sub.trialEnd) return new Date(sub.trialEnd * 1000).toISOString();
    console.warn(`[stripe] trial end not read for ${o.subscriptionId}: ${sub.ok ? "no trial_end" : sub.reason}`);
  }
  return new Date(Date.now() + o.trialDays * 24 * 3600 * 1000).toISOString();
}

export async function onCheckoutCompleted(db: SupabaseClient, o: CompletedOrder, eventId: string): Promise<boolean> {
  const trialEndsAt = await trialEndOf(o);
  const trial = trialEndsAt ? { firstCharge: trialMoment(trialEndsAt, o.market), amount: trialCharge(o.market, TRACKED_PRICE) } : null;
  const r = await clientFromOrder(db, o);
  if (!r.ok) {
    console.error(`[stripe] signup failed for ${eventId}: ${r.outcome}`);
    // A paid order whose signup keeps failing was silent: no order row, no
    // order email, only Stripe's retries (R148 pass 8, 1 Oct 2026). The first
    // failure for a Session writes its order row and tells Danny; a retry finds
    // the row and stays quiet. Still false, so Stripe retries the signup.
    const order = await writeOrder(db, o, r.clientId ?? null, trialEndsAt);
    if (order.inserted) {
      const mail = orderEmailText(o, `FAILED, Stripe will retry it: ${r.outcome} Order row: ${order.text}.`, siteUrl(), trial);
      await sendOrderEmail({ ...mail, subject: `SIGNUP FAILED - ${mail.subject}`, replyTo: o.email });
    }
    return false;
  }
  if (r.clientId) {
    const { error } = await db.from("stripe_events").update({ client_domain_id: r.clientId }).eq("id", eventId);
    if (error) console.warn(`[stripe] event ${eventId} not linked to its client: ${error.message}`);
    // The dashboard's "Free trial - ends <date>" reads this. Logged, not
    // retried: the client is made and the order row carries the date too.
    if (trialEndsAt) {
      const { error: tErr } = await db.from("client_domains").update({ trial_ends_at: trialEndsAt }).eq("id", r.clientId);
      if (tErr) console.error(`[stripe] trial_ends_at not set on client ${r.clientId}: ${tErr.message}`);
    }
  }
  const order = await writeOrder(db, o, r.clientId ?? null, trialEndsAt);
  const mail = orderEmailText(o, `${r.outcome} Order row: ${order.text}.`, siteUrl(), trial);
  await sendOrderEmail({ ...mail, replyTo: o.email });
  return true;
}

/** inserted is false when the Session's row was already there (a retry), or was not written. */
async function writeOrder(db: SupabaseClient, o: CompletedOrder, clientId: string | null, trialEndsAt: string | null = null): Promise<{ text: string; inserted: boolean }> {
  const built = orderRow(o, clientId, trialEndsAt);
  if (!built.row) {
    console.error(`[stripe] order row not written for ${o.sessionId}: ${built.reason}`);
    // No row means nothing marks a retry, so a failing signup mails on each one: noisy beats silent.
    return { text: `not written (${built.reason})`, inserted: true };
  }
  const { data, error } = await db.from("orders").upsert(built.row, { onConflict: "stripe_session_id", ignoreDuplicates: true }).select("stripe_session_id");
  if (error) {
    console.error(`[stripe] order row not written for ${o.sessionId}: ${error.message}`);
    return { text: `NOT written (${error.message})`, inserted: true };
  }
  if (data?.length) return { text: "written", inserted: true };
  // Written by an earlier, failed attempt: link the client this one made.
  if (clientId) {
    const { error: lErr } = await db.from("orders").update({ client_domain_id: clientId }).eq("stripe_session_id", o.sessionId).is("client_domain_id", null);
    if (lErr) console.warn(`[stripe] order ${o.sessionId} not linked to its client: ${lErr.message}`);
  }
  return { text: "already written by an earlier attempt", inserted: false };
}

async function clientOfSubscription(db: SupabaseClient, sub: Record<string, unknown>): Promise<string | null | false> {
  const token = subscriptionScanToken(sub);
  if (token) {
    const { data: scan, error } = await db.from("scans").select("id").eq("public_token", token).maybeSingle();
    if (error) return false;
    if (scan) {
      const { data: c, error: cErr } = await db.from("client_domains").select("id").eq("source_scan_id", scan.id).order("created_at", { ascending: false }).limit(1);
      if (cErr) return false;
      if (c?.[0]?.id) return c[0].id as string;
    }
  }
  // An order with no scan (R158) carries no token, so its subscription found no
  // client and a cancellation ended nothing. The order row holds both ids
  // (8 Oct 2026, found building the trial's cancel).
  const id = typeof sub.id === "string" ? sub.id : "";
  if (!id) return null;
  const { data: o, error: oErr } = await db.from("orders").select("client_domain_id").eq("stripe_subscription_id", id).not("client_domain_id", "is", null).limit(1);
  if (oErr) return false;
  return (o?.[0]?.client_domain_id as string | undefined) ?? null;
}

/** Packs become cluster_limit (limits.ts: 10 + 5 per pack). No client for the subscription: nothing to do. */
export async function onSubscriptionUpdated(db: SupabaseClient, sub: Record<string, unknown>, previous: Record<string, unknown> = {}): Promise<boolean> {
  const clientId = await clientOfSubscription(db, sub);
  if (clientId === false) return false;
  // A trial that became paying changes nothing here; it is worth a line in the log.
  if (trialConverted(sub, previous)) console.info(`[stripe] trial converted to paid: ${String(sub.id)} client ${clientId ?? "none"}`);
  if (!clientId) return true;
  const { error } = await db.from("client_domains").update({ cluster_limit: clusterLimitFor(packsOn(sub)) }).eq("id", clientId);
  if (error) console.error(`[stripe] cluster_limit not set: ${error.message}`);
  return !error;
}

/**
 * Cancelled: the client ends. Nothing is deleted. plan_ended goes to its live
 * owners only when this call ended it (not a client already ended) and its
 * flag is on (R159; off until Danny approves it). A failed send is logged, not retried.
 */
export async function onSubscriptionDeleted(db: SupabaseClient, sub: Record<string, unknown>): Promise<boolean> {
  const clientId = await clientOfSubscription(db, sub);
  if (clientId === false) return false;
  if (!clientId) return true;
  const { data: ended, error } = await db.from("client_domains").update({ status: "ended" }).eq("id", clientId).neq("status", "ended").select("account_id, domain, tier");
  if (error) {
    console.error(`[stripe] client not ended: ${error.message}`);
    return false;
  }
  const row = ended?.[0];
  if (row && (await lifecycleOn(db, "plan_ended"))) {
    const { data: owners, error: oErr } = await db.from("dashboard_members").select("email").eq("account_id", row.account_id).eq("role", "owner").is("removed_at", null);
    if (oErr) console.error(`[stripe] plan_ended not sent, owners not read: ${oErr.message}`);
    const mail = planEnded({ tier: (TIERS.includes(row.tier as string) ? row.tier : "tracked") as TierKey, domain: row.domain as string });
    for (const m of owners ?? []) {
      if (!(await sendLifecycle({ memberEmail: m.email as string, mail }))) console.warn(`[stripe] plan_ended not sent for ${clientId}`);
    }
  }
  return true;
}
