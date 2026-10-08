import assert from "node:assert/strict";
import { test } from "node:test";

import { checkoutRequest } from "./session.ts";
import { clustersToMake, completedOrder, handleWebhook, orderEmailText, orderRow, packsOn, signStripePayload, signupResume, subscriptionScanToken, verifyStripeSignature, type WebhookDeps } from "./webhook.ts";

/**
 * BRIEF-3 C4 (30 Sep 2026): the webhook's rules against recorded fixtures.
 * Nothing here reaches Stripe or Supabase; the writes are injected.
 */

const SECRET = "whsec_test_fixture_not_a_real_secret";
const NOW = 1_790_000_000;
const TOKEN = "57520fc70f3cf9dced06f60186ae059e".replace(/./g, (c, i) => (i % 2 ? c : "a"));

const completed = {
  id: "evt_fixture_completed",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_fixture",
      customer_details: { email: "Owner@Example.com" },
      subscription: "sub_fixture",
      amount_total: 12900,
      currency: "usd",
      metadata: { tier: "tracked", sector: "", quantity: "1", market: "us", keyword: "", scan_token: TOKEN },
    },
  },
};
const updated = {
  id: "evt_fixture_updated",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_fixture", metadata: { scan_token: TOKEN }, items: { data: [{ quantity: 1, price: { metadata: {} } }, { quantity: 2, metadata: { kind: "pack" } }] } } },
};
const deleted = { id: "evt_fixture_deleted", type: "customer.subscription.deleted", data: { object: { id: "sub_fixture", metadata: { scan_token: TOKEN } } } };

function deps(seen = new Set<string>()) {
  const calls: string[] = [];
  const d: WebhookDeps = {
    record: async (id) => {
      calls.push(`record ${id}`);
      if (seen.has(id)) return "duplicate";
      seen.add(id);
      return "new";
    },
    forget: async (id) => {
      calls.push(`forget ${id}`);
      seen.delete(id);
    },
    completed: async (o) => (calls.push(`completed ${o.email} ${o.scanToken}`), true),
    updated: async (s) => (calls.push(`updated ${packsOn(s)}`), true),
    deleted: async (s) => (calls.push(`deleted ${subscriptionScanToken(s)}`), true),
  };
  return { d, calls, seen };
}

const post = (event: unknown, d: WebhookDeps, secret: string | undefined = SECRET, sig?: string | null) => {
  const raw = JSON.stringify(event);
  return handleWebhook(raw, sig === undefined ? signStripePayload(raw, SECRET, NOW) : sig, secret, d, NOW);
};

test("no secret: 503 and nothing acted on, never a skipped check", async () => {
  const { d, calls } = deps();
  const a = await post(completed, d, "");
  assert.equal(a.status, 503);
  assert.deepEqual(calls, []);
});

test("an unsigned, wrongly signed or stale request is refused before it is parsed", async () => {
  for (const sig of [null, "", "t=1,v1=abc", signStripePayload("{}", SECRET, NOW), signStripePayload(JSON.stringify(completed), "whsec_other", NOW)]) {
    const { d, calls } = deps();
    const a = await post(completed, d, SECRET, sig);
    assert.equal(a.status, 400, `accepted ${sig}`);
    assert.deepEqual(calls, []);
  }
  const raw = JSON.stringify(completed);
  assert.equal(verifyStripeSignature(raw, signStripePayload(raw, SECRET, NOW - 301), SECRET, NOW), false, "a signature over five minutes old");
  assert.equal(verifyStripeSignature(raw, signStripePayload(raw, SECRET, NOW - 299), SECRET, NOW), true);
});

test("a replayed event id answers 200 and does nothing the second time", async () => {
  const { d, calls } = deps();
  assert.equal((await post(completed, d)).status, 200);
  const again = await post(completed, d);
  assert.equal(again.status, 200);
  assert.equal(again.body.ignored, "duplicate");
  assert.deepEqual(calls.filter((c) => c.startsWith("completed")).length, 1);
});

test("each handled event reaches its handler, with the fixture's values", async () => {
  const { d, calls } = deps();
  await post(completed, d);
  await post(updated, d);
  await post(deleted, d);
  assert.deepEqual(calls, [
    "record evt_fixture_completed",
    `completed owner@example.com ${TOKEN}`,
    "record evt_fixture_updated",
    "updated 2",
    "record evt_fixture_deleted",
    `deleted ${TOKEN}`,
  ]);
});

test("an event the endpoint is not registered for is answered and not recorded", async () => {
  const { d, calls } = deps();
  const a = await post({ id: "evt_x", type: "invoice.paid", data: { object: {} } }, d);
  assert.equal(a.status, 200);
  assert.deepEqual(calls, []);
});

test("a failed handler forgets the event id, so Stripe's retry is acted on", async () => {
  const { d, calls, seen } = deps();
  d.completed = async () => false;
  assert.equal((await post(completed, d)).status, 500);
  assert.ok(!seen.has(completed.id));
  assert.ok(calls.includes(`forget ${completed.id}`));
});

test("the Session's order: email lowercased, scan token only when it is one", () => {
  const o = completedOrder(completed.data.object);
  assert.equal(o.email, "owner@example.com");
  assert.equal(o.scanToken, TOKEN);
  assert.equal(o.subscriptionId, "sub_fixture");
  assert.equal(completedOrder({ ...completed.data.object, metadata: { scan_token: "../etc" } }).scanToken, null);
});

test("a completed Session becomes one orders row that meets the table's checks", () => {
  const o = completedOrder({ ...completed.data.object, customer: "cus_fixture" });
  assert.deepEqual(orderRow(o, "client-1").row, {
    stripe_session_id: "cs_fixture",
    stripe_customer_id: "cus_fixture",
    stripe_subscription_id: "sub_fixture",
    tier: "tracked",
    sector: null,
    quantity: 1,
    market: "us",
    email: "owner@example.com",
    keyword: null,
    scan_token: TOKEN,
    amount_total: 12900,
    currency: "usd",
    client_domain_id: "client-1",
    // 8 Oct 2026: the alwaystracked trial's first-charge date, null on a paid order.
    trial_ends_at: null,
  });
  // Each check in 20260930020000_orders.sql refuses here before the database would.
  const bad = (m: Record<string, string>, extra: Record<string, unknown> = {}) =>
    orderRow(completedOrder({ ...completed.data.object, ...extra, metadata: { ...completed.data.object.metadata, ...m } }), null);
  assert.equal(bad({ tier: "everywhere" }).row, null);
  assert.equal(bad({ market: "de" }).row, null);
  assert.equal(bad({ quantity: "101" }).row, null);
  assert.equal(bad({}, { customer_details: {}, customer_email: "" }).row, null);
  assert.equal(bad({}, { currency: "eur" }).row?.currency, null);
});

test("signup writes the orders row keyed on the Session id, and every column exists", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./signup.ts", import.meta.url), "utf8");
  assert.ok(src.includes(`from("orders").upsert(built.row, { onConflict: "stripe_session_id", ignoreDuplicates: true })`), "signup.ts no longer upserts orders on the Session id");
  const sql = await readFile(new URL("../../../supabase/migrations/20260930020000_orders.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("stripe_session_id text not null unique"));
  // 8 Oct 2026: trial_ends_at, the 14th column, was added by its own additive migration.
  const trial = await readFile(new URL("../../../supabase/migrations/20261008010000_trial_columns.sql", import.meta.url), "utf8");
  const cols = Object.keys(orderRow(completedOrder(completed.data.object), null).row ?? {});
  assert.equal(cols.length, 14);
  for (const col of cols) {
    assert.ok(sql.includes(`\n  ${col} `) || trial.includes(`alter table orders add column if not exists ${col} `), `orders has no ${col} column`);
  }
});

test("packs count only items marked as a pack", () => {
  assert.equal(packsOn(updated.data.object), 2);
  assert.equal(packsOn({ items: { data: [{ quantity: 3 }] } }), 0);
  assert.equal(packsOn({}), 0);
});

test("the order email names the order and which path the signup took (R158, 1 Oct 2026)", () => {
  const o = completedOrder({ ...completed.data.object, metadata: { tier: "mentioned", sector: "saas", quantity: "3", market: "uk", keyword: "crm" } });
  const m = orderEmailText(o, "no scan and no website on the order, so no client was created", "https://alwayscited.com");
  assert.match(m.text, /Tier: mentioned/);
  assert.match(m.text, /Clusters: 3/);
  assert.match(m.text, /Keyword target: crm/);
  assert.match(m.text, /Path: no scan/);
  assert.match(m.text, /Website: none given - set the client up by hand/);
  assert.match(m.text, /129\.00 USD/);
  const site = orderEmailText(completedOrder({ ...completed.data.object, metadata: { tier: "mentioned", quantity: "2", market: "us", website: "buyer-site.com" } }), "made", "https://alwayscited.com");
  assert.match(site.text, /Path: no scan\n/);
  assert.match(site.text, /Website: buyer-site\.com/);
  const scan = orderEmailText(completedOrder(completed.data.object), "made", "https://alwayscited.com");
  assert.match(scan.text, /Path: scan\n/);
  assert.match(scan.text, new RegExp(`Scan: https://alwayscited\\.com/scan/${TOKEN}`));
});

test("the webhook reads the order's website as untrusted (R158, 1 Oct 2026)", () => {
  const read = (website: unknown) => completedOrder({ ...completed.data.object, metadata: { ...completed.data.object.metadata, website } }).website;
  assert.equal(read("buyer-site.com"), "buyer-site.com");
  assert.equal(read("HTTPS://WWW.Buyer-Site.com/x"), "buyer-site.com");
  for (const bad of ["", "localhost", "a b.com", 7, undefined]) assert.equal(read(bad), null);
});

test("every cluster bought is made once: a scan prefills only cluster 1, the rest need a keyword, a retry makes only the missing (R158, 1 Oct 2026)", () => {
  const N = "Needs a keyword";
  assert.deepEqual(clustersToMake(1, N, N, []), [N], "no scan, one cluster");
  assert.deepEqual(clustersToMake(3, N, N, []), [N, N, N], "no scan, three bought");
  assert.deepEqual(clustersToMake(3, "crm software", N, []), ["crm software", N, N], "scan prefills cluster 1 only");
  assert.deepEqual(clustersToMake(3, "crm software", N, ["crm software"]), [N, N], "retry after cluster 1");
  assert.deepEqual(clustersToMake(3, "crm software", N, ["crm software", N]), [N], "retry after cluster 2");
  assert.deepEqual(clustersToMake(3, N, N, [N, N, N]), [], "a full replay makes nothing");
  assert.deepEqual(clustersToMake(0, N, N, []), [N], "never fewer than one");
});

test("checkout puts a scan token in the Session metadata only when it is one", () => {
  const ctx = { trackedPrice: { us: 129, uk: 99 }, names: { tracked: "alwaystracked", mentioned: "alwaysmentioned", cited: "alwayscited" }, origin: "https://alwayscited.com" as const };
  const base = { tier: "tracked", sector: "", quantity: 1, market: "us", email: "a@example.com", keyword: "", website: "example.com" };
  const withScan = checkoutRequest({ ...base, scan: TOKEN.toUpperCase() }, ctx);
  assert.equal(withScan.kind, "session");
  if (withScan.kind === "session") {
    assert.equal(withScan.form.get("metadata[scan_token]"), TOKEN);
    assert.equal(withScan.form.get("subscription_data[metadata][scan_token]"), TOKEN);
  }
  const bad = checkoutRequest({ ...base, scan: "not-a-token" }, ctx);
  if (bad.kind === "session") assert.equal(bad.form.get("metadata[scan_token]"), null);
});

test("a retried signup reuses its first cluster and writes its keyword and prompts only once (R148 pass 8, 1 Oct 2026)", () => {
  assert.deepEqual(signupResume(null), { clusterId: null, keyword: true, prompts: true }, "first run makes everything");
  assert.deepEqual(signupResume({ id: "c1", keywordId: null, livePrompts: 0 }), { clusterId: "c1", keyword: true, prompts: true }, "cluster made, keyword refused");
  assert.deepEqual(signupResume({ id: "c1", keywordId: "k1", livePrompts: 0 }), { clusterId: "c1", keyword: false, prompts: true }, "keyword made, prompts refused");
  assert.deepEqual(signupResume({ id: "c1", keywordId: "k1", livePrompts: 5 }), { clusterId: "c1", keyword: false, prompts: false }, "owner not added: only the rest runs");
});
