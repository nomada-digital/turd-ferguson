import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkoutRequest, type CheckoutContext, type Order } from "../lib/checkout/session.ts";
import { SECTORS } from "./sector-pricing.ts";
import { completedOrder, orderEmailText, orderRow, trialConverted } from "../lib/checkout/webhook.ts";
import { refuseTrialCancel } from "../lib/tracking/limits.ts";
import { TRIAL, TRIAL_LINE, TRIAL_TERMS, noTrialLine, trialApplies, trialCharge, trialDay, trialLine, trialStatus } from "./trial.ts";

/**
 * The alwaystracked 14-day free trial (Danny, 8 Oct 2026), built dark: every
 * rule here is run with the constant on and off, while the build runs the
 * shipped value - which is off until Danny says yes.
 */

test("the trial ships switched off", () => {
  assert.equal(TRIAL.enabled, false, "turning it on is its own one-line commit after Danny says yes");
  assert.equal(TRIAL.days, 14);
});

// ------------------------------------------------------------- checkout

const ctx = (enabled: boolean, repeat: "email" | "domain" | null = null): CheckoutContext => ({
  trackedPrice: { us: 129, uk: 99 },
  names: { tracked: "alwaystracked", mentioned: "alwaysmentioned", cited: "alwayscited" },
  origin: "https://alwayscited.com",
  trial: { enabled, repeat },
});
const tracked = (o: Partial<Order> = {}): Order => ({ tier: "tracked", sector: "", quantity: 1, market: "us", email: "name@company.com", keyword: "", website: "company.com", ...o });
const TRIAL_KEYS = ["subscription_data[trial_period_days]", "payment_method_collection", "subscription_data[trial_settings][end_behavior][missing_payment_method]", "metadata[trial_days]", "subscription_data[metadata][trial_days]"];

function form(o: Order, c: CheckoutContext): URLSearchParams {
  const r = checkoutRequest(o, c);
  assert.equal(r.kind, "session");
  return r.kind === "session" ? r.form : new URLSearchParams();
}

test("on: a first alwaystracked order with no packs gets 14 days, a card taken, and cancels if the card goes", () => {
  const f = form(tracked(), ctx(true));
  assert.equal(f.get("subscription_data[trial_period_days]"), "14");
  assert.equal(f.get("payment_method_collection"), "always");
  assert.equal(f.get("subscription_data[trial_settings][end_behavior][missing_payment_method]"), "cancel");
  assert.equal(f.get("metadata[trial_days]"), "14");
  assert.equal(f.get("custom_text[submit][message]"), null);
  // The price is untouched: the trial delays the first charge, it does not change it.
  assert.equal(f.get("line_items[0][price_data][unit_amount]"), "12900");
});

test("off: the Session is byte for byte what it was before the trial existed", () => {
  const before = checkoutRequest(tracked(), { ...ctx(false), trial: undefined });
  for (const c of [ctx(false), ctx(false, "email"), { ...ctx(false), trial: undefined }]) {
    const f = form(tracked(), c);
    assert.equal(before.kind === "session" ? before.form.toString() : "", f.toString());
    for (const k of TRIAL_KEYS) assert.equal(f.get(k), null, k);
    assert.equal(f.get("custom_text[submit][message]"), null);
  }
});

test("a repeat email or domain is never refused - it gets the paid order, with a line saying why", () => {
  for (const repeat of ["email", "domain"] as const) {
    const r = checkoutRequest(tracked(), ctx(true, repeat));
    assert.equal(r.kind, "session");
    if (r.kind !== "session") continue;
    assert.equal(r.trial, false);
    for (const k of TRIAL_KEYS) assert.equal(r.form.get(k), null, k);
    assert.match(r.form.get("custom_text[submit][message]") ?? "", /no free trial and the first charge is today/);
  }
});

test("packs mean no trial, and the order says so", () => {
  const r = checkoutRequest(tracked({ packs: 1 }), ctx(true));
  assert.equal(r.kind, "session");
  if (r.kind !== "session") return;
  assert.equal(r.trial, false);
  for (const k of TRIAL_KEYS) assert.equal(r.form.get(k), null, k);
  assert.match(r.form.get("custom_text[submit][message]") ?? "", /No free trial with extra tracking packs/);
});

test("the other tiers never get a trial or a trial line", () => {
  const f = form({ ...tracked(), tier: "mentioned", sector: SECTORS.find((s) => s.prices)!.id, quantity: 1, keyword: "accounting software" }, ctx(true));
  for (const k of TRIAL_KEYS) assert.equal(f.get(k), null, k);
  assert.equal(f.get("custom_text[submit][message]"), null);
  assert.equal(trialApplies({ tier: "cited", packs: 0, repeat: null }, true), false);
  assert.equal(noTrialLine({ tier: "cited", packs: 0, repeat: "email" }, true), null);
});

// ------------------------------------------------------------- webhook

const session = (meta: Record<string, string>) => ({
  id: "cs_test_1",
  customer_email: "name@company.com",
  subscription: "sub_1",
  amount_total: 0,
  currency: "usd",
  metadata: { tier: "tracked", market: "us", quantity: "1", website: "company.com", ...meta },
});

test("a trialing checkout is recognised, records 0 paid and the trial end, and tells Danny the first charge", () => {
  const o = completedOrder(session({ trial_days: "14" }));
  assert.equal(o.trialDays, 14);
  const built = orderRow(o, "client-1", "2026-10-22T10:00:00.000Z");
  assert.ok(built.row);
  assert.equal(built.row!.amount_total, 0);
  assert.equal(built.row!.trial_ends_at, "2026-10-22T10:00:00.000Z");
  const mail = orderEmailText(o, "made", "https://alwayscited.com", { firstCharge: trialDay("2026-10-22T10:00:00.000Z"), amount: trialCharge("us", { us: 129, uk: 99 }) });
  assert.match(mail.text, /^Trial started - first charge 22 Oct 2026, \$129 a month$/m);
});

test("a paid checkout carries no trial", () => {
  const o = completedOrder(session({}));
  assert.equal(o.trialDays, null);
  assert.equal(orderRow(o, null).row!.trial_ends_at, null);
  assert.doesNotMatch(orderEmailText(o, "made", "https://alwayscited.com").text, /Trial started/);
});

test("trialing to active is a conversion; anything else is not", () => {
  assert.equal(trialConverted({ status: "active" }, { status: "trialing" }), true);
  assert.equal(trialConverted({ status: "active" }, {}), false);
  assert.equal(trialConverted({ status: "canceled" }, { status: "trialing" }), false);
});

// ------------------------------------------------------------- cancel

const NOW = Date.parse("2026-10-10T12:00:00Z");
const running = { role: "owner", trialEndsAt: "2026-10-22T10:00:00Z", cancelledAt: null, subscriptionId: "sub_1", now: NOW };

test("cancel is owner only", () => {
  assert.equal(refuseTrialCancel(running), null);
  for (const role of ["editor", "viewer", "removed"]) assert.match(refuseTrialCancel({ ...running, role }) ?? "", /Only an owner/);
});

test("cancel is refused with no trial running, twice, or with no subscription to cancel", () => {
  assert.match(refuseTrialCancel({ ...running, trialEndsAt: null }) ?? "", /no free trial running/);
  assert.match(refuseTrialCancel({ ...running, trialEndsAt: "2026-10-01T00:00:00Z" }) ?? "", /no free trial running/);
  assert.match(refuseTrialCancel({ ...running, cancelledAt: "2026-10-09T00:00:00Z" }) ?? "", /already cancelled/);
  assert.match(refuseTrialCancel({ ...running, subscriptionId: null }) ?? "", /could not find/);
});

// ------------------------------------------------------------- dashboard

test("the plan line: in the client's currency while running, the stop date once cancelled, nothing after", () => {
  const price = { us: 129, uk: 99 };
  assert.equal(trialStatus({ trialEndsAt: running.trialEndsAt, cancelled: false, market: "US", price, now: NOW }), "Free trial - ends 22 Oct 2026. Then $129 a month.");
  assert.equal(trialStatus({ trialEndsAt: running.trialEndsAt, cancelled: false, market: "UK", price, now: NOW }), "Free trial - ends 22 Oct 2026. Then £99 + VAT a month.");
  assert.equal(trialStatus({ trialEndsAt: running.trialEndsAt, cancelled: true, market: "US", price, now: NOW }), "Trial cancelled - tracking stops 22 Oct 2026");
  assert.equal(trialStatus({ trialEndsAt: running.trialEndsAt, cancelled: false, market: "US", price, now: Date.parse("2026-10-23T00:00:00Z") }), null);
  assert.equal(trialStatus({ trialEndsAt: null, cancelled: false, market: "US", price, now: NOW }), null);
});

// ------------------------------------------------------------- copy

const SRC = new URL("../", import.meta.url).pathname;
const read = (f: string) => readFileSync(SRC + f, "utf8");

/** Every surface that shows the alwaystracked price, and so draws the trial line while it is on. */
const SURFACES = [
  "components/PackagePage.tsx", // the tier page
  "components/home/Packages.tsx", // the homepage pricing band and the /packages grid
  "components/checkout/CheckoutOrder.tsx",
  "app/what-is-aeo/page.tsx", // the FAQ that quotes the tracking price
  "app/alwaystracked/page.tsx", // the tier page's description, which llms.txt prints
  "components/scan/ResultView.tsx", // the scan result's tracking offer
];

test("on, only alwaystracked gains the line; off, nothing does", () => {
  assert.equal(trialLine("tracked", true), TRIAL_LINE);
  for (const t of ["mentioned", "cited", "everywhere"] as const) assert.equal(trialLine(t, true), null);
  for (const t of ["tracked", "mentioned", "cited", "everywhere"] as const) assert.equal(trialLine(t, false), null);
  assert.equal(TRIAL_LINE, "14 days free, card required. Cancel before day 15 and you pay nothing.");
});

test("every price surface draws the line through trialLine, so the one constant switches all of them", () => {
  assert.ok(SURFACES.length >= 6, "the floor: a list that shrinks is a sweep that stopped matching");
  for (const f of SURFACES) assert.match(read(f), /trialLine\(/, f);
  // llms.txt prints the tier page's description rather than drawing its own.
  assert.match(read("app/llms.txt/pages.ts"), /from "@\/app\/alwaystracked\/page"/);
});

test("the legal clause is drawn only while the trial is on, and says what Danny asked for", () => {
  assert.match(read("app/legal/page.tsx"), /\.\.\.\(TRIAL\.enabled\s*\?/);
  const terms = TRIAL_TERMS.join(" ");
  for (const must of [/14-day free trial/, /starts when you complete checkout/, /take a card at checkout/, /day 15/, /Cancel trial/, /one trial per website/, /thirty days to stop/]) {
    assert.match(terms, must);
  }
  assert.doesNotMatch(terms, /[–—]/);
});
