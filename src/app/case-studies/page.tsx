import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";

import { CHATGPT_VISIBILITY, KEYWORD_EIGHT_WEEKS, KEYWORD_FOUR_MONTHS } from "@/config/client-results";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { publishedCaseStudies } from "@/lib/case-studies";

/**
 * The evidence index, from CaseStudies.dc.html.
 *
 * One study, because there is one. The board draws three more rows of
 * [CASE STUDY TITLE] and [HEADLINE FIGURE]; a page that invents two more
 * clients to look busier is the one thing an evidence page cannot do.
 *
 * The card carries the keyword moves and the visibility figure. That last
 * one was published in three forms across this site - 25% against the full
 * question set, 14% against the same, and 14% against ChatGPT alone - until
 * Danny settled it as the account owner on 19 Sep 2026: ChatGPT brand
 * visibility, 25%, with no window attached because none is sourced.
 *
 * All three figures now come from `config/client-results.ts` rather than
 * being typed here, which is what stops a fourth form appearing. This page
 * was already the one that scoped them correctly - "Over eight weeks", "Of
 * the tracked prompts", "Four months in" - and the homepage was not.
 *
 * ## "and when" came off all three surfaces on 20 Sep 2026
 *
 * The line read "every figure says what it was measured against **and when**",
 * on the meta description, the OG description and the standfirst. The first
 * half is true and `client-results.test.mts` holds it. The second half was
 * flatly false: what each figure carries is a scope, and every scope here is
 * a duration or a denominator - "Over eight weeks", "Four months in", "Of the
 * tracked prompts". None of them is a date, and `ClientResult.attested` -
 * the one field that holds a date - is documented in its own config as **not
 * rendered**.
 *
 * What settles it rather than making it a wording argument: the page this one
 * exists to link to says so itself. `/case-studies/vibe-retail` carries a
 * visible `[TO CONFIRM]` reading **"the date each reading was taken, and
 * which tracker"**, and a second on "the dates each reading covers". So the
 * index promised precisely the thing the study two clicks away flags as
 * unknown, which is blocked.md item 3.
 *
 * The date was not added instead, because there is none to add that could be
 * stood behind: 19 Sep 2026 is when Danny attested the figures, not when the
 * readings were taken, and AGENTS.md puts a number about a client's result
 * behind a dated source. Answer item 3 and this line can have its second half
 * back. Same call as `67bc96d`, `486d63a` and `b3a25ba` - a claim that is
 * flatly false for a product is narrowed unattended; a claim that is merely
 * generous waits for Danny.
 */

export const metadata: Metadata = {
  title: "What the work actually moved",
  description:
    "Short case studies, and every figure says what it was measured against. Clients are named only where the agency has agreed to it.",
  alternates: { canonical: "https://alwayscited.com/case-studies" },
  openGraph: {
    images: OG_IMAGE,
    title: "What the work actually moved | alwayscited",
    description: "Short case studies, and every figure says what it was measured against.",
    url: "https://alwayscited.com/case-studies",
  },
};

/**
 * Studies published from the Nomada agency hub (4 Oct 2026) list under the
 * Vibe Retail study. Their figures are not typed here or in client-results:
 * each comes with its own window from the hub's tracking - see
 * `lib/case-studies.ts`. Re-read every five minutes; none published, none drawn.
 */
export const revalidate = 300;

export default async function CaseStudiesPage() {
  const studies = await publishedCaseStudies();
  return (
    <section style={{ ...SHELL, paddingTop: "44px", display: "flex", flexDirection: "column", gap: "26px" }}>
      <div className="board-head confirm-head">
        <div>
          {/* The beat, from globals.css. The study card animates as one row
              rather than animating its own stat panels - it is already a row,
              and a row inside a row reads as mush. */}
          <div className="ac-row" style={MICRO}>Evidence</div>
          <h1 className="ac-row" style={{ margin: "8px 0 0", fontSize: "27px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
            What the work actually moved
          </h1>
        </div>
        <p className="ac-row" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
          Short, and every figure says what it was measured against. Clients are named only where the agency
          has agreed to it, which is why this one is a sector rather than a brand.
        </p>
      </div>

      <Link
        className="ac-row"
        href="/case-studies/vibe-retail"
        style={{ ...CARD, display: "block", padding: "28px 30px", textDecoration: "none" }}
      >
        <div className="confirm-top study-top">
          <div>
            <div style={{ ...MICRO, color: T.accent }}>US retail SaaS - eight weeks</div>
            <h2
              style={{
                margin: "10px 0 0",
                fontSize: "23px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.24,
                color: T.ink,
              }}
            >
              One placement, on a best-of list already ranking for the category
            </h2>
            <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "62ch" }}>
              A single placement, on a third-party page that already ranked for the category.
            </p>
          </div>
          {/* Cells wrap at 150px: with a zero basis the panel never wrapped,
              and at 390 "#83 to #4" broke over three lines (Q18). */}
          <div
            style={{
              display: "flex",
              background: T.bg,
              border: "1px solid " + T.line,
              borderRadius: "14px",
              overflow: "hidden",
              alignSelf: "start",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flexGrow: 1, flexBasis: "150px", padding: "18px 20px" }}>
              <div style={{ fontSize: "12.5px", color: T.soft }}>Money keyword</div>
              <div
                style={{
                  fontSize: "27px",
                  fontWeight: 700,
                  letterSpacing: "-0.035em",
                  lineHeight: 1.15,
                  marginTop: "2px",
                  color: T.ink,
                }}
              >
                {KEYWORD_EIGHT_WEEKS.value}
              </div>
              <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>Over {KEYWORD_EIGHT_WEEKS.scope}</div>
            </div>
            <div style={{ flexGrow: 1, flexBasis: "150px", padding: "18px 20px", borderLeft: "1px solid " + T.line }}>
              <div style={{ fontSize: "12.5px", color: T.soft }}>ChatGPT brand visibility</div>
              <div
                style={{
                  fontSize: "27px",
                  fontWeight: 700,
                  letterSpacing: "-0.035em",
                  lineHeight: 1.15,
                  marginTop: "2px",
                  color: T.ink,
                }}
              >
                {CHATGPT_VISIBILITY.value}
              </div>
              <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>Of the {CHATGPT_VISIBILITY.scope}</div>
            </div>
            <div style={{ flexGrow: 1, flexBasis: "150px", padding: "18px 20px", borderLeft: "1px solid " + T.line }}>
              <div style={{ fontSize: "12.5px", color: T.soft }}>The same keyword</div>
              <div
                style={{
                  fontSize: "27px",
                  fontWeight: 700,
                  letterSpacing: "-0.035em",
                  lineHeight: 1.15,
                  marginTop: "2px",
                  color: T.ink,
                }}
              >
                {KEYWORD_FOUR_MONTHS.value}
              </div>
              <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>
                {/* The scope is lowercase so it reads inside a label; this is
                    the one site that opens a sentence with it. */}
                Four months in
              </div>
            </div>
          </div>
        </div>
      </Link>

      {studies.map((st) => (
        <Link
          key={st.id}
          className="ac-row"
          href={`/case-studies/${st.id}`}
          style={{ ...CARD, display: "block", padding: "28px 30px", textDecoration: "none" }}
        >
          <div className="confirm-top study-top">
            <div>
              <div style={{ ...MICRO, color: T.accent }}>
                {[st.named ? st.client : null, st.market, st.periodLabel].filter(Boolean).join(" - ")}
              </div>
              <h2 style={{ margin: "10px 0 0", fontSize: "23px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.24, color: T.ink }}>
                {st.headline}
              </h2>
              {st.intro && (
                <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "62ch" }}>{st.intro}</p>
              )}
            </div>
            {!!st.kpis?.length && (
              <div style={{ display: "flex", background: T.bg, border: "1px solid " + T.line, borderRadius: "14px", overflow: "hidden", alignSelf: "start", flexWrap: "wrap" }}>
                {st.kpis.slice(0, 3).map((k, i) => (
                  <div key={k.l} style={{ flexGrow: 1, flexBasis: "150px", padding: "18px 20px", borderLeft: i ? "1px solid " + T.line : undefined }}>
                    <div style={{ fontSize: "12.5px", color: T.soft }}>{k.l}</div>
                    <div style={{ fontSize: "27px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.15, marginTop: "2px", color: T.ink }}>{k.n}</div>
                    <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>Over {st.periodLabel ?? "the window"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Link>
      ))}

      <p className="ac-row" style={{ margin: 0, fontSize: "13px", color: T.soft, lineHeight: 1.6 }}>
        Nothing on this page is modelled or projected. Where a reading came from a third-party tracker rather than our
        own run, the case study says which.
      </p>
    </section>
  );
}
