import { trialMoment, trialStatus } from "../../config/trial.ts";

/**
 * The plan banner (8 Oct 2026, audit activation-12, activation-5): a strip
 * across the top of every dashboard page at every width - the plan card is
 * hidden on phones - for the things a client must not miss. Drawn by
 * Sidebar.tsx; decided here, so every state is tested without a page.
 *
 * In order: tracking has ended (for payment, BL-2, or otherwise); the last
 * payment failed and Stripe is retrying (BL-2, 9 Oct 2026, owners only); how
 * long the free trial has left.
 */

export type BannerLink = { href: string; label: string; external?: boolean };
export type PlanBanner = { tone: "trial" | "ended" | "payment"; text: string; link: BannerLink | null };

export type BannerClient = {
  name: string;
  market: string;
  status?: string;
  trial_ends_at?: string | null;
  trial_cancelled_at?: string | null;
  payment_status?: string | null;
  payment_retry_at?: string | null;
  payment_invoice_url?: string | null;
  payment_ended_at?: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day in the client's own time zone, "14 Oct 2026", as trialMoment picks the zone. */
export function paymentDay(iso: string, market: string): string {
  const zone = market.toLowerCase() === "uk" ? "Europe/London" : "America/New_York";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function planBanner(p: {
  client: BannerClient;
  role: string;
  /** upsell_mode is nomada: Billing has Ask us. Agency and off modes bill through the account contact, never us (review of 2379757). */
  upsell: boolean;
  /** Settings' Billing section on this client. */
  billing: string;
  price: { us: number; uk: number };
  now?: number;
}): PlanBanner | null {
  const { client: c, role, upsell, billing } = p;
  const now = p.now ?? Date.now();
  const owner = role === "owner";

  if (c.status === "ended") {
    // An ended client is not sent to checkout: a new order cannot yet bring the
    // old client back (review of 2379757), so the owner asks us, where billing is.
    // BL-2: ended because Stripe stopped charging says so, not that the plan was cancelled.
    const text = c.payment_ended_at
      ? `Tracking has stopped for ${c.name} because the plan is unpaid. Everything read so far stays here`
      : `Tracking has ended for ${c.name}. Everything read so far stays here`;
    return owner && upsell
      ? { tone: "ended", text: `${text}.`, link: { href: billing, label: "Ask us to restart it" } }
      : { tone: "ended", text: `${text} - ${upsell ? "an owner can ask us to restart it" : "your account contact can restart it"}.`, link: null };
  }

  // BL-2 (9 Oct 2026): Stripe is retrying a failed payment. The owner pays, so
  // only the owner is told; tracking carries on meanwhile. The fix is the
  // invoice's own Stripe page when the webhook has it, else Billing's Ask us.
  if (c.payment_status === "past_due" && owner) {
    const retry = c.payment_retry_at && Date.parse(c.payment_retry_at) > now ? ` We try the card again on ${paymentDay(c.payment_retry_at, c.market)}.` : "";
    const link: BannerLink | null = c.payment_invoice_url
      ? { href: c.payment_invoice_url, label: "Pay the invoice", external: true }
      : upsell
        ? { href: billing, label: "Ask us about it" }
        : null;
    return { tone: "payment", text: `Your last payment did not go through.${retry}${link ? "" : " Your account contact can help."}`, link };
  }

  // The alwaystracked trial (8 Oct 2026): "Free trial - ends <date>. Then $129 a month." or the cancelled line.
  const trial = trialStatus({ trialEndsAt: c.trial_ends_at ?? null, cancelled: Boolean(c.trial_cancelled_at), market: c.market, price: p.price, now });
  if (!trial) return null;
  if (c.trial_ends_at && !c.trial_cancelled_at) {
    const daysLeft = Math.ceil((Date.parse(c.trial_ends_at) - now) / 86_400_000);
    return { tone: "trial", text: `Free trial: ${daysLeft === 1 ? "1 day" : `${daysLeft} days`} left, ends ${trialMoment(c.trial_ends_at, c.market)}.`, link: { href: billing, label: "Billing" } };
  }
  return { tone: "trial", text: trial, link: { href: billing, label: "Billing" } };
}
