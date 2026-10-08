import type { Metadata } from "next";

import TierName, { TIER_PLAIN, TierText } from "@/components/TierName";
import CheckoutOrder from "@/components/checkout/CheckoutOrder";
import NextSteps from "@/components/NextSteps";
import { CHECKOUT_LIMITS } from "@/config/contact";
import { TIERS } from "@/config/pricing";
import { parseSelection, tierFromPlain } from "@/config/sector-selection";
import { MICRO, SHELL, T } from "@/config/tokens";
import { CHECKOUT_TIERS, type CheckoutTier } from "@/lib/checkout/session";

export const dynamic = "force-dynamic";

/** An order in progress - noindex here, in the header rule and in robots.txt. */
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * The order form (R91 part 3, pricing spec section 5): the plan, the market,
 * the keyword target, sector, quantity and email, before payment. The
 * card itself is CheckoutOrder, an island so the price follows the US/UK
 * toggle with no reload (Danny, 1 Oct 2026, danny.md lines 156-157); it is
 * plain HTML both ways with no script, and "Continue to payment" posts the
 * picks to /api/checkout, which builds the Session from the price config.
 * The page only reads and validates the URL.
 */

/** The refusals /api/checkout sends back; CheckoutOrder holds their words. */
const ERRORS = ["email", "keyword", "website", "failed"];

export default async function Checkout({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const params = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string"));
  const named = tierFromPlain(q.tier);
  const tier: CheckoutTier = named && (CHECKOUT_TIERS as readonly string[]).includes(named) ? (named as CheckoutTier) : "tracked";
  const sel = parseSelection(params);
  const tierPage = TIERS.find((t) => t.key === tier)!;
  const error = q.error && ERRORS.includes(q.error) ? q.error : undefined;
  const keyword = (q.keyword ?? "").slice(0, CHECKOUT_LIMITS.keyword.max);
  // The free scan this order came from, carried to the Session for the webhook (BRIEF-3 C4).
  const scan = /^[0-9a-f]{32}$/i.test(q.scan ?? "") ? q.scan!.toLowerCase() : null;
  // Without one, the order asks for the website the dashboard is built for (R158).
  const website = (q.website ?? "").slice(0, CHECKOUT_LIMITS.website);

  return (
    <section style={{ ...SHELL, maxWidth: "560px", paddingTop: "48px", paddingBottom: "96px" }}>
      <div style={MICRO}>Checkout</div>
      <h1 style={{ margin: "10px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
        Start <TierName tier={tier} />
      </h1>
      <CheckoutOrder
        tier={tier}
        tierPlain={TIER_PLAIN[tier]}
        plan={<TierName tier={tier} />}
        tierPage={tierPage.href}
        includes={tierPage.includes.slice(0, 3).map((line) => <TierText key={line}>{line}</TierText>)}
        initial={sel}
        scan={scan}
        keyword={keyword}
        website={website}
        error={error}
      />
      <NextSteps style={{ marginTop: "24px" }} />
    </section>
  );
}
