import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PAYMENT_ENDS, afterFailedInvoice, afterSubscription, endedForPayment, hostedInvoiceUrl, invoiceSubscription, newerThanRecorded, staleEvent, withPayment, type PaymentRow, type PaymentStep } from "./payment.ts";

/**
 * BL-2 (9 Oct 2026): payment-state handling. A card that failed for good
 * left the client tracked every day at our cost - customer.subscription.updated
 * rewrote only cluster_limit, and the runner dispatches every active client -
 * and its owner was never told. Recorded payloads only; nothing reaches
 * Stripe or Supabase.
 */

const T0 = 1_790_000_000;
const iso = (s: number) => new Date(s * 1000).toISOString();
const ACTIVE: PaymentRow = { status: "active", payment_status: null, payment_status_at: null, payment_ended_at: null };
const INVOICE_URL = "https://invoice.stripe.com/i/acct_fixture/test_fixture_invoice";
const invoice = (o: Record<string, unknown> = {}) => ({ id: "in_fixture", billing_reason: "subscription_cycle", next_payment_attempt: T0 + 3 * 86_400, hosted_invoice_url: INVOICE_URL, subscription: "sub_fixture", ...o });

test("past_due is recorded for the banner and tracking carries on", () => {
  const s = afterSubscription(ACTIVE, { status: "past_due" }, T0);
  assert.deepEqual(s, { write: { payment_status: "past_due", payment_status_at: iso(T0) }, end: false, restore: false, cancel: false });
});

test("unpaid, paused and incomplete_expired end the client in the same write, and say it was for payment", () => {
  assert.deepEqual([...PAYMENT_ENDS], ["unpaid", "paused", "incomplete_expired"]);
  for (const status of PAYMENT_ENDS) {
    const s = afterSubscription({ ...ACTIVE, payment_status: "past_due", payment_status_at: iso(T0 - 86_400) }, { status }, T0);
    assert.deepEqual(s.write, { payment_status: status, payment_status_at: iso(T0), payment_ended_at: iso(T0), status: "ended" }, status);
    assert.equal(s.end, true, status);
  }
  // A client already ended - a cancellation, say - is not re-ended, and is not marked as ended for payment.
  const e = afterSubscription({ ...ACTIVE, status: "ended" }, { status: "unpaid" }, T0);
  assert.equal(e.end, false);
  assert.deepEqual(e.write, { payment_status: "unpaid", payment_status_at: iso(T0) });
});

test("canceled ends through endClient and clears the payment mark, so a cancellation is the end that sticks", () => {
  const s = afterSubscription({ status: "ended", payment_status: "unpaid", payment_status_at: iso(T0 - 60), payment_ended_at: iso(T0 - 60) }, { status: "canceled" }, T0);
  assert.equal(s.cancel, true);
  assert.equal(s.end, false, "the end is endClient's, with plan_ended, not this write's");
  assert.deepEqual(s.write, { payment_status: "canceled", payment_status_at: iso(T0), payment_ended_at: null });
});

test("a client ended for payment is made active again when Stripe is paid; one ended any other way stays ended", () => {
  const unpaid: PaymentRow = { status: "ended", payment_status: "unpaid", payment_status_at: iso(T0 - 86_400), payment_ended_at: iso(T0 - 86_400) };
  assert.equal(endedForPayment(unpaid), true);
  for (const status of ["active", "trialing"]) {
    const s = afterSubscription(unpaid, { status }, T0);
    assert.equal(s.restore, true, status);
    assert.deepEqual(s.write, { payment_status: status, payment_status_at: iso(T0), payment_retry_at: null, payment_invoice_url: null, payment_ended_at: null, status: "active" }, status);
  }
  assert.equal(afterSubscription(unpaid, { status: "past_due" }, T0).restore, true, "Stripe retrying again: tracked again, with the banner");
  assert.equal(afterSubscription(unpaid, { status: "incomplete" }, T0).restore, false);
  // Ended by a cancellation (no payment mark), or by hand: a paid status does not bring it back.
  const cancelled: PaymentRow = { status: "ended", payment_status: "canceled", payment_status_at: iso(T0 - 60), payment_ended_at: null };
  assert.equal(endedForPayment(cancelled), false);
  assert.equal(afterSubscription(cancelled, { status: "active" }, T0).restore, false);
  assert.equal(afterSubscription({ ...ACTIVE, status: "ended" }, { status: "active" }, T0).write?.status, undefined);
});

test("a paid status clears the failed invoice's retry date and page; past_due keeps them", () => {
  const due: PaymentRow = { ...ACTIVE, payment_status: "past_due", payment_status_at: iso(T0 - 60) };
  assert.deepEqual(afterSubscription(due, { status: "active" }, T0).write, { payment_status: "active", payment_status_at: iso(T0), payment_retry_at: null, payment_invoice_url: null });
  assert.equal("payment_invoice_url" in afterSubscription(due, { status: "past_due" }, T0).write!, false);
});

test("an event older than the recorded one does nothing; a tie is taken, and an unknown status is not recorded", () => {
  const rec: PaymentRow = { ...ACTIVE, payment_status: "active", payment_status_at: iso(T0) };
  assert.equal(staleEvent(rec, T0 - 1), true);
  assert.equal(staleEvent(rec, T0), false);
  assert.equal(staleEvent(ACTIVE, 0), false, "nothing recorded yet");
  assert.equal(afterSubscription(rec, { status: "unpaid" }, T0 - 1).write, null, "an unpaid delivered after the payment that cleared it ends nobody");
  assert.equal(afterSubscription(rec, { status: "unpaid" }, T0 - 1).end, false);
  assert.equal(afterFailedInvoice(rec, invoice(), T0 - 1).write, null);
  assert.equal(afterSubscription(ACTIVE, { status: "on_hold" }, T0).write, null);
  assert.equal(afterSubscription(ACTIVE, {}, T0).write, null);
  // The same rule as the update's own filter, so two events read at once cannot both write, the older last.
  assert.equal(newerThanRecorded(T0), `payment_status_at.is.null,payment_status_at.lte."${iso(T0)}"`);
});

test("invoice.payment_failed records past_due with Stripe's retry date and the invoice's own page", () => {
  assert.deepEqual(afterFailedInvoice(ACTIVE, invoice(), T0).write, { payment_status: "past_due", payment_status_at: iso(T0), payment_retry_at: iso(T0 + 3 * 86_400), payment_invoice_url: INVOICE_URL });
  assert.equal(afterFailedInvoice(ACTIVE, invoice({ next_payment_attempt: null }), T0).write?.payment_retry_at, null, "no more attempts");
  const s = afterFailedInvoice(ACTIVE, invoice(), T0);
  assert.equal(s.end || s.restore || s.cancel, false, "an invoice never moves the client's status");
  assert.equal("status" in s.write!, false);
  // The first invoice: Checkout shows that failure on its own form, and a scan bought twice would mark its first client.
  assert.equal(afterFailedInvoice(ACTIVE, invoice({ billing_reason: "subscription_create" }), T0).write, null);
  // Never over a status that has already stopped tracking.
  for (const payment_status of [...PAYMENT_ENDS, "canceled"]) assert.equal(afterFailedInvoice({ ...ACTIVE, payment_status, payment_status_at: iso(T0 - 60) }, invoice(), T0).write, null, payment_status);
});

test("an invoice's subscription is read in both of Stripe's shapes, and only a subscription id is taken", () => {
  const meta = { scan_token: "a".repeat(32) };
  assert.deepEqual(invoiceSubscription({ parent: { subscription_details: { subscription: "sub_new", metadata: meta } } }), { id: "sub_new", metadata: meta }, "API 2025-03-31 on");
  assert.deepEqual(invoiceSubscription({ subscription: "sub_old", subscription_details: { metadata: meta } }), { id: "sub_old", metadata: meta }, "before it");
  assert.deepEqual(invoiceSubscription({ subscription: { id: "sub_expanded" } }), { id: "sub_expanded", metadata: {} }, "expanded");
  for (const bad of [{}, { subscription: null }, { subscription: "cus_x" }, { subscription: "sub_../x" }]) assert.equal(invoiceSubscription(bad), null, JSON.stringify(bad));
});

test("only a Stripe invoice page is kept as the banner's link", () => {
  assert.equal(hostedInvoiceUrl({ hosted_invoice_url: INVOICE_URL }), INVOICE_URL);
  assert.equal(hostedInvoiceUrl({ hosted_invoice_url: `${INVOICE_URL}?s=ap` }), `${INVOICE_URL}?s=ap`);
  for (const bad of ["http://invoice.stripe.com/i/x", "https://invoice.stripe.com.evil.example/i/x", "https://evil.example/https://invoice.stripe.com/", "javascript:alert(1)", "https://invoice.stripe.com/i/x\"><script>", `https://invoice.stripe.com/${"a".repeat(600)}`, 7, null]) {
    assert.equal(hostedInvoiceUrl({ hosted_invoice_url: bad }), null, String(bad));
  }
});

/**
 * Stripe does not order delivery. A failed card that is never fixed, and one
 * fixed after tracking stopped, are replayed here in every order the events
 * could arrive, through a store that writes as signup.ts's update does: the
 * whole step in one write, only over an older event (newerThanRecorded), and
 * a cancellation ending the client as endClient does.
 */
type Event = { kind: "sub" | "invoice"; status?: string; at: number; next?: number | null };

function deliver(events: Event[]): PaymentRow {
  let row: PaymentRow = { ...ACTIVE };
  for (const e of events) {
    const step: PaymentStep = e.kind === "sub" ? afterSubscription(row, { status: e.status }, e.at) : afterFailedInvoice(row, invoice({ next_payment_attempt: e.next ?? null }), e.at);
    if (step.cancel) row = { ...row, status: "ended" };
    const w = step.write;
    if (w && (row.payment_status_at === null || Date.parse(row.payment_status_at) <= e.at * 1000)) {
      row = { status: w.status ?? row.status, payment_status: w.payment_status, payment_status_at: w.payment_status_at, payment_ended_at: w.payment_ended_at === undefined ? row.payment_ended_at : w.payment_ended_at };
    }
  }
  return row;
}

function orders<X>(xs: X[]): X[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

test("in any delivery order, a payment never made stops tracking and one made after it stopped starts it again", () => {
  const failed: Event[] = [
    { kind: "invoice", at: T0, next: T0 + 3 * 86_400 },
    { kind: "sub", status: "past_due", at: T0 },
    { kind: "invoice", at: T0 + 3 * 86_400, next: T0 + 5 * 86_400 },
    { kind: "sub", status: "unpaid", at: T0 + 5 * 86_400 },
    { kind: "invoice", at: T0 + 5 * 86_400, next: null },
  ];
  let n = 0;
  for (const o of orders(failed)) {
    const r = deliver(o);
    assert.equal(r.status, "ended", JSON.stringify(o));
    assert.ok(endedForPayment(r), `ended for payment: ${JSON.stringify(o)}`);
    n += 1;
  }
  const paid = [...failed, { kind: "sub", status: "active", at: T0 + 9 * 86_400 } as Event];
  for (const o of orders(paid)) {
    const r = deliver(o);
    assert.equal(r.status, "active", JSON.stringify(o));
    assert.equal(r.payment_status, "active", JSON.stringify(o));
    assert.equal(r.payment_ended_at, null);
    n += 1;
  }
  // Paid before the retries ran out: never ended at all.
  for (const o of orders(failed.slice(0, 3).concat({ kind: "sub", status: "active", at: T0 + 4 * 86_400 }))) {
    assert.deepEqual([deliver(o).status, deliver(o).payment_status], ["active", "active"], JSON.stringify(o));
    n += 1;
  }
  // Cancelled after it stopped: ended for good, and a late "active" from before the cancellation brings nothing back.
  const gone = [...failed.slice(3, 4), { kind: "sub", status: "active", at: T0 + 6 * 86_400 } as Event, { kind: "sub", status: "canceled", at: T0 + 8 * 86_400 } as Event];
  for (const o of orders(gone)) {
    const r = deliver(o);
    assert.equal(r.status, "ended", JSON.stringify(o));
    assert.equal(endedForPayment(r), false, JSON.stringify(o));
    n += 1;
  }
  assert.ok(n >= 120 + 720 + 24 + 6, `only ${n} orders replayed`);
});

test("the dashboard's payment read failing costs the banner, never the clients", () => {
  const clients = [{ id: "a", slug: "a" }, { id: "b", slug: "b" }];
  assert.deepEqual(withPayment(clients, null), clients, "a failed read: every client as if nothing were wrong");
  const got = withPayment(clients, [{ id: "a", payment_status: "past_due", payment_retry_at: iso(T0), payment_invoice_url: INVOICE_URL, payment_ended_at: null }, { id: "b", payment_invoice_url: "https://evil.example/pay" }]);
  assert.deepEqual(got[0], { id: "a", slug: "a", payment_status: "past_due", payment_retry_at: iso(T0), payment_invoice_url: INVOICE_URL, payment_ended_at: null });
  assert.equal(got[1]!.payment_invoice_url, null, "checked again on the way out");
  assert.equal(got[1]!.payment_status, null);
});

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("census: the webhook writes payment state only over an older event, only to a client its order row names, and the dashboard reads it on its own", () => {
  // 9 Oct 2026, review of 2c6dc99: the payment step moved from signup.ts to subscription-events.ts, so it runs under test.
  const events = src("./subscription-events.ts");
  assert.ok(events.includes('.update(step.write).eq("id", client.id).or(newerThanRecorded(at))'), "the payment write is no longer guarded by the event's time");
  assert.equal(events.match(/\.update\(/g)?.length, 1, "one payment write");
  assert.match(events, /if \(!client\.exact\) return true;\s*const row = await paymentRow\(/, "the payment step is no longer held to a client an order row names");
  // The order row is read before the scan, and the scan only when no order row names the subscription.
  assert.ok(events.indexOf('.eq("stripe_subscription_id", id)') > 0 && events.indexOf('.eq("stripe_subscription_id", id)') < events.indexOf('.eq("source_scan_id", scan.id)'), "the scan is read before the order row");
  assert.ok(events.includes("const token = e.ordered.length ? null : subscriptionScanToken(sub);"), "the scan is read even when an order row names the subscription");
  const signup = src("./signup.ts");
  assert.equal(signup.match(/\.update\(step\.write\)/g), null, "signup.ts writes payment state of its own");
  assert.equal(signup.match(/await clientOfSubscription\(db, sub\)/g)?.length, 3, "updated, deleted and trial_will_end find their client one way");
  assert.ok(!signup.includes('.eq("source_scan_id"'), "signup.ts finds a subscription's client by its scan again");
  assert.match(signup, /if \(!client\?\.exact\) return true;\s*const clientId = client\.id;\s*return mailTrialEnding\(/, "trial_will_end mails a client guessed from its scan");
  // Deletion still ends the client (and mails plan_ended) before the canceled status is recorded.
  const del = signup.slice(signup.indexOf("export async function onSubscriptionDeleted("), signup.indexOf("async function endClient("));
  assert.ok(del.indexOf("endClient(db, client.id, sub)") > 0 && del.indexOf("endClient(db, client.id, sub)") < del.indexOf("recordPayment("), "onSubscriptionDeleted ends the client first");
  // Never a client email from the payment step: the failed-payment emails are Stripe's, Danny's setting (LB4).
  assert.ok(!/\b(send|mail)[A-Z]\w*\(/.test(events.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")), "subscription-events.ts sends mail");
  const member = readFileSync(new URL("../tracking/member.ts", import.meta.url), "utf8");
  assert.ok(member.includes(".select(PAYMENT_BANNER_READ)"), "the banner's columns are not read on their own");
  assert.ok(member.includes("withPayment(clients, pErr ? null :"), "a failed payment read is not handed on as null");
  const main = member.match(/\.select\("id, account_id[^"]*"\)/)?.[0] ?? "";
  assert.ok(main && !main.includes("payment_"), "the clients read names a payment column, so its failure would hold back the dashboard");
});

test("the migration adds every column the webhook and the dashboard name, additively", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261009030000_payment_state.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map((x) => x.trim()).filter(Boolean);
  for (const stmt of statements) assert.match(stmt, /^alter table client_domains add column if not exists payment_\w+ (text|timestamptz)$/, stmt);
  const cols = new Set(statements.map((x) => x.split(/\s+/)[8]));
  for (const c of ["payment_status", "payment_status_at", "payment_retry_at", "payment_invoice_url", "payment_ended_at"]) assert.ok(cols.has(c), c);
  assert.equal(cols.size, 5);
});
