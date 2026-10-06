"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import BrandMark from "@/components/BrandMark";
import { NAV, navHref } from "@/components/app/nav";
import TierName from "@/components/TierName";
import { MICRO, T } from "@/config/tokens";
import { appPath } from "@/lib/app-host";

/**
 * The dashboard's 404 (R173 pass 3, DS35, 2 Oct 2026). A page under
 * /app/[client] that calls notFound() - Placements on a plan without it, a
 * cluster link from before it was stopped - fell through to
 * src/app/not-found.tsx, which offers a free scan and the packages page: a
 * dead end for a signed-in client.
 *
 * Here the reader stays in the dashboard, drawn as error.tsx draws it: the
 * alwaystracked lockup, Back to the Overview and every other dashboard page,
 * from the slug in the URL alone.
 */
export default function DashboardNotFound() {
  const { client } = useParams<{ client: string }>();
  const overview = navHref("Overview", client) ?? appPath("");
  const others = NAV.filter((n) => n !== "Overview").flatMap((item) => {
    const href = navHref(item, client);
    return href ? [{ item, href }] : [];
  });

  return (
    <div className="app-shell" style={{ display: "flex", flexDirection: "column", minHeight: "100vh", color: T.ink, background: T.bg }}>
      <header style={{ display: "flex", alignItems: "center", height: "60px", padding: "0 24px", background: T.surface, borderBottom: `1px solid ${T.line}` }}>
        {/* Not a link, as the Sidebar's lockup is not: the site logo is the one tier lockup in a link (result-copy.test.mts). */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em" }}>
          <BrandMark id="app-not-found" size={15} />
          <TierName tier="tracked" />
        </div>
      </header>

      <div id="app-content" tabIndex={-1} className="app-main" style={{ flex: "1 1 auto", padding: "36px 40px 48px", maxWidth: "720px" }}>
        <div style={MICRO}>404</div>
        <h1 style={{ margin: "10px 0 0", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2 }}>That page is not in this dashboard.</h1>
        <p style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.soft, maxWidth: "56ch" }}>
          The link may be from before something changed, or the page may not be part of this dashboard. Everything else is where you left it.
        </p>

        <div style={{ marginTop: "24px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link href={overview} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", boxSizing: "border-box", fontSize: "15px", fontWeight: 600, color: "#ffffff", background: T.accent, borderRadius: "10px", padding: "12px 26px", textDecoration: "none" }}>
            Back to the Overview
          </Link>
        </div>

        <nav aria-label="Other dashboard pages" style={{ marginTop: "28px" }}>
          <div style={MICRO}>Or go to</div>
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            {others.map((n) => (
              <li key={n.item}>
                <Link href={n.href} style={{ display: "inline-flex", alignItems: "center", fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  {n.item}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
