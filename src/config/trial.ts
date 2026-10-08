import type { TierKey } from "../lib/tier-text.ts";

/**
 * The alwaystracked free trial (Danny, 8 Oct 2026): 14 days, card required,
 * the first charge on day 15.
 *
 * Built dark. A code constant rather than an app_settings row, because every
 * surface that shows the price is a static page and a settings read there
 * would make it dynamic. Turning it on is a one-line commit after Danny says
 * yes - see the list at the top of the Part 3 report before flipping it.
 *
 * Every reader takes `enabled` as a parameter defaulting to this, so the tests
 * run both states while the build runs the shipped one.
 */
export const TRIAL = { enabled: false, days: 14 } as const;

/** The line every alwaystracked price surface gains while the trial is on. */
export const TRIAL_LINE = "14 days free, card required. Cancel before day 15 and you pay nothing.";

/** The trial line for a tier's price, or null: only alwaystracked, only while on. */
export function trialLine(tier: TierKey, enabled: boolean = TRIAL.enabled): string | null {
  return enabled && tier === "tracked" ? TRIAL_LINE : null;
}

/**
 * Who gets the trial at checkout: alwaystracked with no extra packs, a domain
 * and an email that have never been through alwayscited before.
 * `repeat` is what the order and client reads found; null when nothing did.
 */
export type TrialRepeat = "email" | "domain" | null;

export function trialApplies(p: { tier: string; packs: number; repeat: TrialRepeat }, enabled: boolean = TRIAL.enabled): boolean {
  return enabled && p.tier === "tracked" && p.packs === 0 && p.repeat === null;
}

/**
 * The line Stripe shows above Pay when an order that could have had the trial
 * does not - a repeat, or packs. Never a refusal: the paid order goes ahead.
 */
export function noTrialLine(p: { tier: string; packs: number; repeat: TrialRepeat }, enabled: boolean = TRIAL.enabled): string | null {
  if (!enabled || p.tier !== "tracked") return null;
  if (p.packs > 0) return "No free trial with extra tracking packs, so the first charge is today.";
  if (p.repeat === "email") return "This email has used alwayscited before, so there is no free trial and the first charge is today.";
  if (p.repeat === "domain") return "This website has used alwayscited before, so there is no free trial and the first charge is today.";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A London calendar day, "22 Oct 2026", from a timestamp. */
export function trialDay(iso: string): string {
  const [y, m, d] = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" }).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** What the first charge will be, in the client's currency: "$129 a month", UK "£99 + VAT a month". */
export function trialCharge(market: string, price: { us: number; uk: number }): string {
  return market.toLowerCase() === "uk" ? `£${price.uk} + VAT a month` : `$${price.us} a month`;
}

/**
 * The dashboard's plan line while a trial is running or cancelled, or null
 * when the client is not on one (or it has ended).
 */
export function trialStatus(p: { trialEndsAt: string | null; cancelled: boolean; market: string; price: { us: number; uk: number }; now?: number }): string | null {
  if (!p.trialEndsAt) return null;
  if (new Date(p.trialEndsAt).getTime() <= (p.now ?? Date.now())) return null;
  const day = trialDay(p.trialEndsAt);
  return p.cancelled ? `Trial cancelled - tracking stops ${day}` : `Free trial - ends ${day}. Then ${trialCharge(p.market, p.price)}.`;
}

/**
 * The trial clause for /legal, drawn only while the trial is on. A draft:
 * legal copy for Danny to read before the switch, not reviewed by a lawyer.
 * Plain sentences so llms and the test read the same words the page does.
 */
export const TRIAL_TERMS: readonly string[] = [
  "alwaystracked comes with a 14-day free trial for a website and an email address that have not used us before. There is one trial per website and one per email address, ever; a repeat order is taken as a paid one, and the order form says so before you pay.",
  "The trial starts when you complete checkout, not at the first check, so days spent setting up count towards the 14.",
  "We take a card at checkout and charge nothing during the trial. The first charge is the monthly price - plus VAT in the UK - on day 15. The date is in your dashboard under Settings, and Stripe shows it before you pay.",
  "To cancel during the trial, an owner uses Cancel trial in the dashboard, under Settings and then Billing, or emails us. Tracking carries on until the trial ends and nothing is charged.",
  "Once the first charge is taken, the plan's usual terms apply: monthly, no minimum term, thirty days to stop. Orders with extra tracking packs, and the other plans, have no trial.",
];
