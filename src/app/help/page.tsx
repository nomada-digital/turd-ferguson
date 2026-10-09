import type { Metadata } from "next";
import Link from "next/link";

import { HelpAside, HelpText } from "@/components/HelpShell";
import { TierText } from "@/components/TierName";
import { HELP, HELP_INDEX, QUICK, SIGN_IN_HREF, helpHref, helpIndexMetadata } from "@/config/help";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";

/**
 * The help centre's index (MK-2, 9 Oct 2026). The two questions the item was
 * written for lead the quick answers - "why is this 27%?" and "why is today
 * partial?" - then every article, then the way into the dashboard. Copy is
 * config/help.ts; read its header before adding a sentence here.
 */

export const metadata: Metadata = helpIndexMetadata();

export default function HelpIndexPage() {
  return (
    <div className="post-shell" style={{ ...SHELL, paddingTop: "40px" }}>
      <div>
        <div className="ac-row" style={MICRO}>
          Help
        </div>
        <h1 className="ac-row" style={{ margin: "10px 0 0", fontSize: "34px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.18, color: T.ink }}>
          <TierText>{HELP_INDEX.heading}</TierText>
        </h1>
        <p className="ac-row" style={{ margin: "14px 0 0", fontSize: "16px", lineHeight: 1.6, color: T.soft, maxWidth: "68ch" }}>
          <TierText>{HELP_INDEX.standfirst}</TierText>
        </p>
        <p className="ac-row" style={{ margin: "14px 0 0", fontSize: "14px" }}>
          <a href={SIGN_IN_HREF} style={{ color: T.accent, fontWeight: 600 }}>
            Sign in to your dashboard
          </a>
        </p>

        <section aria-labelledby="quick" className="ac-row" style={{ ...CARD, marginTop: "26px", padding: "22px 24px" }}>
          <h2 id="quick" style={{ margin: 0, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
            Quick answers
          </h2>
          <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
            {QUICK.map((q) => (
              <li key={q.href}>
                <Link href={q.href} style={{ display: "flex", alignItems: "center", minHeight: "40px", fontSize: "15px", fontWeight: 600, textDecoration: "none", color: T.accent }}>
                  {q.q}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="articles" style={{ marginTop: "30px" }}>
          <h2 id="articles" className="ac-row" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
            Every article
          </h2>
          <ul style={{ margin: "14px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
            {HELP.map((a) => (
              <li key={a.slug} className="ac-row" style={{ ...CARD, padding: "18px 22px" }}>
                <Link href={helpHref(a.slug)} style={{ fontSize: "16px", fontWeight: 700, textDecoration: "none", color: T.ink }}>
                  {a.title}
                </Link>
                <p style={{ margin: "6px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
                  <HelpText text={a.description} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <HelpAside current={null} />
    </div>
  );
}
