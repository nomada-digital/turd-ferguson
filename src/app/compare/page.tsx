import type { Metadata } from "next";
import Link from "next/link";
import { OG_IMAGE } from "@/config/og";

import TierName from "@/components/TierName";
import { listIf } from "@/config/capabilities";
import { TIERS } from "@/config/pricing";
import { CARD, GRID12, MICRO, SHELL, T } from "@/config/tokens";

export const metadata: Metadata = {
  title: "How we compare",
  description:
    "What alwayscited does and what it costs, row by row. No competitor columns - we do not publish a claim about another company without a dated source.",
  openGraph: { url: "https://alwayscited.com/compare", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/compare" },
};

/**
 * Compare.dc.html, without the competitor columns.
 *
 * The board has an 8-row table against Peec, Profound and Ahrefs Brand
 * Radar in which all 24 competitor cells are [VERIFY], and its own sidebar
 * promises each row is taken from that company's public pricing "with the
 * date we read it". That reading has not happened, so those columns are not
 * here - a comparison page is the one place where being wrong is about
 * somebody else's business rather than our own layout.
 *
 * The table is built as a column set rather than a fixed three-column grid,
 * so adding a competitor later is adding an entry to COLUMNS and a value per
 * row.
 *
 * **There is one thing else to restructure, and it is not in this file.**
 * `.cmp-row`'s base rule is `2fr repeat(auto-fit, minmax(0, 1fr))`, which does
 * grow. Its 860px rule is `1fr auto` - two tracks, hard-typed - so a third cell
 * wraps under the feature name on a phone, in the header row as well as the
 * body, because the header carries `.cmp-row` too. Both sibling families solved
 * this the same way and neither is visible from here: `.q-row` and the `.res-*`
 * set reflow to `1fr auto` and hide their header with `.q-head`/`.res-head
 * { display: none }`. `.cmp-row` is the one member with no head class to hide.
 *
 * The best argument on the board survives untouched: the card saying when a
 * tracking tool is the better purchase. That needs nobody else's facts.
 *
 * **It did not survive 8 Oct 2026 (LB7).** "A pure tracking tool is cheaper
 * than us and probably better instrumented" sat on the page whose entry price
 * is the alwaystracked plan - the site sending its own tracking buyer
 * elsewhere, with an undated claim about other companies' tools. It is cut.
 * The card left beside it lost its label too: "When we are" only read as the
 * second half of the pair, and a longer label would be new selling words, which
 * are Danny's (on review, later that day). The card that replaces the cut one,
 * and the framing of this one - which still turns away the buyer who wants
 * measurement, on the page whose entry price is the alwaystracked plan - are
 * his LB7 decision. "White label for agencies: Yes" waits on
 * `dashboardBranding` (LB1): no dashboard carries an agency's brand yet.
 */

type Column = { key: string; label: React.ReactNode; emphasis?: boolean };

/** Add a competitor here, and a value under its key in every ROW, once each
 *  cell has been read from their public material and dated. */
const COLUMNS: Column[] = [{ key: "us", label: <TierName tier="cited" />, emphasis: true }];

const entry = TIERS.find((t) => t.id === "tracked")?.priceLabel ?? "";

const ROWS: { feature: string; values: Record<string, string> }[] = [
  { feature: "Tells you which sources decide the category", values: { us: "Yes" } },
  { feature: "Tracks whether the brand gets named", values: { us: "Yes" } },
  { feature: "Stores what each engine said behind every reading", values: { us: "Yes" } },
  { feature: "Places your brand into those source pages", values: { us: "Yes" } },
  { feature: "Reports the Google position alongside the citation", values: { us: "Yes" } },
  ...listIf("dashboardBranding", { feature: "White label for agencies", values: { us: "Yes" } }),
  { feature: "Price published without a call", values: { us: "Yes" } },
  { feature: "Entry price", values: { us: entry } },
];

export default function ComparePage() {
  return (
    <div style={{ ...SHELL, paddingTop: "44px", paddingBottom: "44px", display: "flex", flexDirection: "column", gap: "28px" }}>
      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        {/* The beat, from globals.css. The table head is deliberately not a
            row: eight features plus a header is nine in one group, which is
            the stagger cap exactly, and the cap is a ladder with a ceiling -
            the defect species this site keeps finding. Leaving the head out
            animates the content and keeps a row of headroom for a ninth
            feature. */}
        <div style={{ gridColumn: "span 7" }}>
          <div className="ac-row" style={MICRO}>Comparison</div>
          <h1 className="ac-row" style={{ margin: "10px 0 0", fontSize: "36px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.18, color: T.ink }}>
            AI visibility tools, and what each one leaves you to do yourself.
          </h1>
          <p className="ac-row" style={{ margin: "14px 0 0", fontSize: "15px", lineHeight: 1.6, color: T.soft, maxWidth: "62ch" }}>
            Most of these are good at what they do. The question is not which dashboard is best - it is what happens
            after it tells you the answer.
          </p>
        </div>

        <div className="ac-row" style={{ ...CARD, gridColumn: "span 5", padding: "22px" }}>
          <div style={MICRO}>Why there are no other columns here yet</div>
          <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            A row about somebody else&apos;s product is only worth reading if it was taken from their own pricing and
            documentation, with the date it was read. We have not done that work yet, so rather than publish a grid of
            guesses about other companies, this page sets out what we do and what it costs.
          </p>
          <p style={{ margin: "10px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            When the columns arrive they will carry that date, and if one goes out of date, tell us and we will correct
            it.
          </p>
        </div>
      </div>

      {/* --cmp-cols is read by .cmp-row in globals.css, so a column added to
          COLUMNS gets its track without anyone touching the stylesheet. */}
      <div style={{ ...CARD, overflow: "hidden", ["--cmp-cols" as string]: COLUMNS.length } as React.CSSProperties}>
        <div className="cmp-row" style={{ padding: "11px 26px", background: "#fbfbfc", borderBottom: `1px solid ${T.line}` }}>
          <div style={MICRO}>&nbsp;</div>
          {COLUMNS.map((c) => (
            <div key={c.key} style={{ ...MICRO, color: c.emphasis ? T.ink : T.soft }}>
              {c.label}
            </div>
          ))}
        </div>
        {ROWS.map((r) => (
          <div key={r.feature} className="cmp-row ac-row" style={{ padding: "12px 26px", borderBottom: `1px solid ${T.hair}`, alignItems: "baseline" }}>
            <div style={{ fontSize: "14px", fontWeight: 500, color: T.ink }}>{r.feature}</div>
            {COLUMNS.map((c) => (
              <div key={c.key} style={{ fontSize: "13.5px", color: T.ink, fontWeight: c.emphasis ? 600 : 400 }}>
                {r.values[c.key] ?? "-"}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="ac-row" style={{ ...CARD, border: `1px solid ${T.accent}`, padding: "24px" }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.ink }}>
          When you need the gap closed rather than measured, and you do not have relationships with the
          sites the engines read. That is the whole difference, and it is a supply problem rather than a software one.
        </p>
        {/* R151 (1 Oct 2026): the page ended here with nothing to do next -
            no link or control in main at all. One primary action, as on
            /pr-agencies, and a quiet way to the prices. */}
        <div style={{ marginTop: "18px", display: "flex", alignItems: "center", gap: "18px", flexWrap: "wrap" }}>
          <Link
            href="/#scan"
            className="btn-primary"
            style={{
              // No inline colour: .btn-primary sets white on its gradient, and
              // contrast.test.mts measures that pair there, not against this card.
              fontSize: "15px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "10px",
              textDecoration: "none",
              minHeight: "44px",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
            }}
          >
            Run a free scan
          </Link>
          <Link href="/packages" style={{ fontSize: "14px", fontWeight: 600, textDecoration: "none", color: T.accent, minHeight: "44px", display: "flex", alignItems: "center" }}>
            See the packages
          </Link>
        </div>
      </div>
    </div>
  );
}
