import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";

import DarkClosing from "@/components/DarkClosing";
import { D, LIFT_SOFT } from "@/components/home/dark";
import { word } from "@/components/home/EngineDemo";
import { TierText, TIER_PLAIN } from "@/components/TierName";
import { DEAREST_PRICED_TIER, publishedPricesClause, quotedPricesClause, TIERS } from "@/config/pricing";
import { CARD, GRID12, MICRO, SHELL, T } from "@/config/tokens";
import { trialLine } from "@/config/trial";
import { ENGINE_SPECS, FREE_ENGINES } from "@/lib/scan/engines";
import { FREE_ENGINE_COUNT, listOf, QUESTIONS } from "@/config/scan-shape";
import { ORG_REF, ld } from "@/config/schema";

/**
 * What is AEO - the guide page, built to WhatIsAeo.dc.html (R18, 26 Sep
 * 2026). The board arrived after Q24; until then this page had none, and the
 * paragraphs below record how it was held without one. The board's order: the
 * definition beside its hero, the one beat (a results page with the Google row
 * and the answer both marked - one pass, settling marked, not the board's 12s
 * loop), the SEO/AEO table, a contents rail beside one sectioned card, the FAQ
 * and the dark closing scan. The copy is the board's, which is the cut-down
 * form of the sourced copy below; every sentence of it was already here.
 *
 * This and /how-it-works are the two public pages with no artboard, which is
 * why they were still on the pre-redesign palette - Georgia headings, navy
 * #0D1B2A, orange #D85A30 - after every other surface had moved. The 19 Sep
 * CSS sweep looked for #0B1220 and #F8F7FF and found neither, because this
 * page never used those two. There were two legacy palettes in the tree, and
 * the sweep that declared the token migration finished only knew about one.
 *
 * No board means no board to copy, so the rules in inbox.md stand in for one:
 * tokens only, h1 36px/700/-0.03em, h2 19px, body 14-15px, the 1180 container,
 * sentence case, hyphens.
 *
 * This used to carry "No motion - the one-beat-per-page rule takes its
 * vocabulary from a board's own keyframes, and inventing a beat for a page
 * that has no board is a different thing from following the rule." Sound when
 * written, and overtaken since: `91101d6` lifted `.ac-row` out of the boards
 * into globals.css as the site's single entrance and applied it from two
 * shared templates, so the beat is now the site's rather than any one board's
 * and using it here is copying rather than inventing. The rule stands; it no
 * longer excludes this page. Same reversal on /how-it-works, same reason.
 *
 * On the copy: blocked.md listed seven unsourced claims across this page and
 * /how-it-works, twice, and Danny has not answered. AGENTS.md is not ambiguous
 * about the state that leaves the site in - a statement about what an engine
 * does carries [VERIFY] until there is a dated source, and these were
 * published as plain fact. Copy is reversible and explicitly mine, so rather
 * than leave them live for a third session I applied the test blocked.md
 * itself recommended. Every sentence here is now one of: a description of
 * what we do, something our own scans actually observe, or gone.
 *
 * Cut outright, and recoverable from git at 6b473ac: the "most B2B buyers
 * research through AI search" market statistic; the engine market-share
 * ordering, three ranked claims about other companies; the 1-4 week and 4-8
 * week results benchmarks and the "SEO takes 3-6 months" comparison; the
 * 3,000-5,000/month retainer range, which was a claim about what other
 * agencies charge and undercut our own published prices two clicks away; the
 * 6-12 month recency window; and the same-day citation anecdote, which is a
 * client result with no dated source. The full before-and-after is in
 * worklog.md.
 *
 * The mechanism claims are kept but reattributed. We cannot see inside an
 * engine; we can see the sources behind an answer, because every scan records
 * them. That is a smaller claim and it is one we can stand behind.
 */

export const metadata: Metadata = {
  title: "What is AEO? Answer engine optimisation",
  description:
    "AEO is getting a brand named inside an AI-generated answer rather than ranked in the links underneath it. How it differs from SEO, and how we measure it.",
  alternates: { canonical: "https://alwayscited.com/what-is-aeo" },
  openGraph: {
    images: OG_IMAGE,
    title: "What is AEO? Answer engine optimisation | alwayscited",
    description:
      "AEO is getting a brand named inside an AI-generated answer rather than ranked in the links underneath it.",
    url: "https://alwayscited.com/what-is-aeo",
  },
};

/** One place that knows the JSON-LD envelope, so no block repeats it. */
function jsonLd(type: string, body: Record<string, unknown>): string {
  return ld({ "@context": "https://schema.org", "@type": type, ...body });
}

const articleSchema = jsonLd("Article", {
  headline: "What is AEO? A guide to answer engine optimisation",
  description:
    "AEO (answer engine optimisation) is the practice of getting a brand named and cited inside the answer an AI search system generates, rather than ranked in the list of links underneath it.",
  url: "https://alwayscited.com/what-is-aeo",
  author: ORG_REF,
  publisher: ORG_REF,
});

const freeEngines = listOf(FREE_ENGINES.map((e) => ENGINE_SPECS[e].label));

const tracked = TIERS.find((t) => t.id === "tracked");
const mentioned = TIERS.find((t) => t.id === "mentioned");
const cited = TIERS.find((t) => t.id === "cited");

/**
 * The first sentence of a price basis, trimmed for use mid-sentence.
 *
 * Not a lowercase of the whole string: the bases in pricing.ts are two
 * sentences, and lowercasing the lot produced "checked weekly. more questions
 * or a tighter cadence moves the price" in the rendered FAQ and in the
 * FAQPage schema with it.
 */
function firstClause(s: string): string {
  const first = s.split(". ")[0].replace(/[.]+$/, "");
  return first.charAt(0).toLowerCase() + first.slice(1);
}

/**
 * The prices come from pricing.ts so this page cannot contradict the pricing
 * card, which is exactly what the old copy did.
 *
 * Tier names stay TIER_PLAIN in the string itself, because it is serialised
 * into the FAQPage schema below and JSON-LD is one of the contexts that strips
 * colour. The answer is rendered through TierText on the way to the page, so
 * the visible copy still gets the lockup - one string, both contexts, nothing
 * to drift.
 */
/*
 * The opening line used to be "Ours are published rather than quoted." - which
 * is the claim this answer then spends three sentences supporting for three
 * tiers, while the fourth is a call. Both halves come from pricing.ts now, and
 * the quoted clause goes AFTER the figures rather than in front of them so the
 * answer still opens on what a buyer can read off the page.
 */
const priceAnswer = [
  publishedPricesClause(),
  tracked ? "Tracking is " + tracked.priceLabel + "." + (tracked.priceBasis ? " " + tracked.priceBasis.replace(/\.?$/, ".") : "") + (trialLine("tracked") ? " " + trialLine("tracked") : "") : "",
  mentioned ? "Placements start at " + mentioned.priceLabel + " under " + TIER_PLAIN.mentioned + "." : "",
  cited
    ? "The " + TIER_PLAIN.cited + " plan, which adds the on-site work and the link insertions, is " + cited.priceLabel + "."
    : "",
  quotedPricesClause(),
  "What other agencies charge is not something we can source, so this page does not say.",
]
  .filter(Boolean)
  .join(" ");

type Faq = { q: string; hint: string; a: string };

const FAQS: Faq[] = [
  {
    q: "Is AEO replacing SEO?",
    hint: "No - it sits on top of it",
    a: "No. A placement is an ordinary link as well as a page an engine can read as a source, so one article can move a citation and a Google position. We report the two separately, because only one of them may have moved.",
  },
  {
    q: "Can I do AEO myself?",
    hint: "The on-site half, yes",
    a: "Some of it. FAQ schema, question-format headings, comparison tables and opening lines in the buyer’s phrasing are all yours to ship. Getting into the third-party pages the engines already read is relationship work with publishers, not a change you can deploy.",
  },
  {
    q: "Which AI systems do you read?",
    hint: FREE_ENGINES.length + " on the free scan",
    a: "A free scan reads " + freeEngines + ". We do not publish a ranking of which engine matters most - we have no source for one, and it depends on who your buyers are.",
  },
  {
    q: "How do you measure results?",
    hint: "Two measures, never averaged",
    a:
      "Whether you were named in the answer, across a tracked question set" +
      (tracked?.priceBasis ? " - " + firstClause(tracked.priceBasis) : "") +
      ". And the Google position for the same question, which comes back in the same read. A citation and a ranking are different outcomes and we never roll them into one score.",
  },
  {
    q: "What does it cost?",
    // Was "Published, not quoted", which is the same overclaim as the answer
    // under it. Names the range instead, off the same derivation.
    hint: DEAREST_PRICED_TIER ? "Published up to " + DEAREST_PRICED_TIER.plainName : "Quoted",
    a: priceAnswer,
  },
];

/** Built from the array the page renders, so the two cannot drift apart. */
const faqSchema = jsonLd("FAQPage", {
  mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

const COMPARISON: { row: string; seo: string; aeo: string }[] = [
  { row: "Target surface", seo: "The list of links", aeo: "The answer written above them" },
  { row: "What is measured", seo: "Your position on a keyword", aeo: "Whether the answer named you" },
  { row: "Where the work lands", seo: "Mostly your own pages", aeo: "Mostly pages the engines already cite" },
  { row: "Who has to say yes", seo: "A ranking system", aeo: "An editor" },
  { row: "Buyer touchpoint", seo: "A click", aeo: "No click needed" },
];

/** The Google results under the answer. Tallyroo is third - the row SEO
 *  counts. Made-up brands, as the board's are, and said so under the card. */
const SERP: { n: number; name: string; domain: string; you?: boolean }[] = [
  { n: 1, name: "Ledgerbird", domain: "ledgerbird.com" },
  { n: 2, name: "Stackbill", domain: "stackbill.io" },
  { n: 3, name: "Tallyroo", domain: "tallyroo.com", you: true },
  { n: 4, name: "Pennywell", domain: "pennywell.com" },
];

const CLOCKS: { label: string; head: string; body: string; accent?: boolean }[] = [
  { label: "The placement", head: "Live in weeks", body: "It goes onto a page that already has standing, so nothing is built from zero." },
  { label: "The citation", head: "The next time the engine reads the page", body: "Not a schedule anyone outside the engine controls.", accent: true },
  { label: "The Google position", head: "On its own timetable", body: "Reported apart from the citation, so you can see which moved." },
];

const CONTENTS: { id: string; label: string }[] = [
  { id: "decide", label: "How engines decide who to name" },
  { id: "engineer", label: "Can it be engineered on purpose?" },
  { id: "long", label: "How long it takes" },
  { id: "faq", label: "Questions we get asked" },
];

const H2_BIG: React.CSSProperties = { margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink };
const H2_LONG: React.CSSProperties = { margin: 0, fontSize: "22px", fontWeight: 700, letterSpacing: "-0.025em", color: T.ink };
const LEDE: React.CSSProperties = { margin: 0, fontSize: "15px", lineHeight: 1.6, color: T.soft };
/** Long-form body prose, the value PostShell and the case study draw. */
const PROSE: React.CSSProperties = { margin: "14px 0 0", fontSize: "15px", lineHeight: 1.7, color: "#3f4451", maxWidth: "68ch" };
const SUB: React.CSSProperties = { margin: "8px 0 0", fontSize: "13px", fontWeight: 600, color: T.soft };

function Head({ title, lede, id }: { title: string; lede: string; id?: string }) {
  return (
    <div id={id} className="board-head" style={{ ...GRID12, marginTop: "80px", scrollMarginTop: "2rem" }}>
      <h2 style={{ ...H2_BIG, gridColumn: "span 5" }}>{title}</h2>
      <p style={{ ...LEDE, gridColumn: "span 7" }}>{lede}</p>
    </div>
  );
}

export default function WhatIsAEOPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleSchema }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema }} />

      <div style={{ ...SHELL, paddingTop: "64px", paddingBottom: "64px" }}>
        <div className="guide-top guide-top--aeo">
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>Answer engine optimisation</div>
            <h1 className="guide-h1" style={{ margin: "12px 0 0", fontSize: "48px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05, color: T.ink }}>
              What is AEO? A guide to answer engine optimisation.
            </h1>
            <p style={{ margin: "18px 0 0", fontSize: "17px", lineHeight: 1.55, color: T.soft, maxWidth: "52ch" }}>
              Getting a brand named inside the answer, rather than ranked in the links underneath it. Same buyer,
              different surface, different thing to measure.
            </p>
          </div>

          {/* Kept whole so it can be quoted - the definition the Article
              schema's description repeats. */}
          <div style={{ ...CARD, borderRadius: "18px", padding: "22px 24px" }}>
            <div style={MICRO}>The short version</div>
            <p style={{ margin: "10px 0 0", fontSize: "14.5px", lineHeight: 1.65, color: T.ink }}>
              AEO (answer engine optimisation) is the practice of getting a brand named and cited inside the answer an
              AI search system generates - Google&apos;s AI Overview, ChatGPT, Perplexity and the rest - rather than
              ranked in the list of links below it. Where SEO targets a position, AEO targets the citation.
            </p>
          </div>
        </div>

        {/* The page's one beat: one results page, two measures. */}
        <section style={{ marginTop: "72px" }}>
          <div className="board-head" style={{ display: "flex", alignItems: "baseline", gap: "40px" }}>
            <h2 style={{ ...H2_BIG, flexShrink: 0 }}>One results page, two things to measure</h2>
            <p style={LEDE}>SEO counts where you sit in the links. AEO counts whether the answer above them names you.</p>
          </div>
          {/* The entrance is on a wrapper so the beat's own classes are the
              only animation on each element; seq-stagger.test.mts holds that. */}
          <div className="ac-row">
          <div className="guide-beat">
            <div style={{ ...CARD, borderRadius: "18px", padding: "22px 24px", boxShadow: LIFT_SOFT }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", border: "1px solid " + T.line, borderRadius: "999px", padding: "10px 16px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <span style={{ fontSize: "14.5px", color: T.ink }}>best invoicing software for freelancers</span>
              </div>
              <div style={{ marginTop: "16px", background: T.bg, borderRadius: "14px", padding: "16px 18px" }}>
                <div style={MICRO}>AI Overview</div>
                <p style={{ margin: "8px 0 0", fontSize: "14.5px", lineHeight: 1.7, color: T.ink }}>
                  For most freelancers the usual picks are Ledgerbird for its free tier and{" "}
                  <span className="aeo-hl-aeo" style={{ borderRadius: "5px", padding: "1px 5px", margin: "0 -2px", background: T.washLine, color: T.accentHover, fontWeight: 700 }}>
                    Tallyroo
                  </span>{" "}
                  for recurring invoices and late-payment reminders. Stackbill suits anyone who also needs expenses.
                </p>
                <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {["solodesk.io", "quillandcoin.co"].map((d) => (
                    <span key={d} style={{ fontSize: "11.5px", fontWeight: 600, color: T.soft, background: T.surface, border: "1px solid " + T.line, borderRadius: "999px", padding: "1px 10px", lineHeight: 1.8 }}>
                      {d}
                    </span>
                  ))}
                </div>
              </div>
              <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                {SERP.map((r) => (
                  <li
                    key={r.name}
                    className={r.you ? "aeo-hl-seo" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: r.you ? T.chip : undefined,
                      boxShadow: r.you ? "inset 0 0 0 1.5px " + T.ink : undefined,
                    }}
                  >
                    <span style={{ width: "22px", fontSize: "13px", fontWeight: 700, color: r.you ? T.ink : T.soft }}>{r.n}</span>
                    <span style={{ fontSize: "14px", fontWeight: r.you ? 700 : 600, color: T.ink }}>{r.name}</span>
                    <span style={{ fontSize: "13px", color: T.soft }}>{r.domain}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="aeo-card-seo" style={{ flexGrow: 1, background: T.surface, border: "1.5px solid " + T.ink, borderRadius: "18px", padding: "22px 24px", display: "flex", flexDirection: "column" }}>
                <div style={MICRO}>SEO measures</div>
                <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700, color: T.ink }}>Your position on the keyword</div>
                <div style={{ flexGrow: 1, minHeight: "16px" }} />
                <div style={{ fontSize: "52px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, color: T.ink }}>#3</div>
                <div style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>The buyer has to scroll past the answer and click</div>
              </div>
              <div className="aeo-card-aeo" style={{ flexGrow: 1, background: T.surface, border: "1.5px solid " + T.accent, borderRadius: "18px", padding: "22px 24px", display: "flex", flexDirection: "column" }}>
                <div style={{ ...MICRO, color: T.accent }}>AEO measures</div>
                <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700, color: T.ink }}>Whether the answer named you</div>
                <div style={{ flexGrow: 1, minHeight: "16px" }} />
                <div className="aeo-named" style={{ alignSelf: "flex-start", fontSize: "20px", fontWeight: 700, color: T.accentHover, background: T.wash, borderRadius: "999px", padding: "6px 16px" }}>
                  Named
                </div>
                <div style={{ marginTop: "10px", fontSize: "13px", color: T.soft }}>Across every question, on every engine. No click needed</div>
              </div>
            </div>
          </div>
          </div>
          <div className="guide-notes" style={{ color: T.soft }}>
            <span>One piece of work can move both. We report them separately, never averaged.</span>
            <span>Illustrative. Tallyroo and every brand shown are made up.</span>
          </div>
        </section>

        <section>
          <Head title="How AEO differs from SEO" lede="The differences that change what you do, rather than every difference there is." />
          <div style={{ ...CARD, borderRadius: "18px", overflow: "hidden", marginTop: "24px" }}>
            <div className="board-head" style={{ ...GRID12, padding: "13px 26px", borderBottom: "1px solid " + T.line }}>
              <div style={{ ...MICRO, gridColumn: "span 4" }}>Difference</div>
              <div style={{ ...MICRO, gridColumn: "span 4" }}>SEO</div>
              <div style={{ ...MICRO, gridColumn: "span 4", color: T.accent }}>AEO</div>
            </div>
            {COMPARISON.map((c, i) => (
              <div key={c.row} className="board-head" style={{ ...GRID12, padding: "16px 26px", borderTop: i ? "1px solid " + T.hair : undefined }}>
                <div style={{ gridColumn: "span 4", fontSize: "14.5px", fontWeight: 600, color: T.ink }}>{c.row}</div>
                <div style={{ gridColumn: "span 4", fontSize: "14.5px", color: T.soft }}>{c.seo}</div>
                <div style={{ gridColumn: "span 4", fontSize: "14.5px", fontWeight: 500, color: T.ink }}>{c.aeo}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="guide-long">
          <nav aria-label="On this page" className="guide-long__nav">
            <div style={MICRO}>On this page</div>
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" }}>
              {CONTENTS.map((c, i) => (
                <li key={c.id}>
                  <a
                    href={"#" + c.id}
                    style={{
                      display: "block",
                      padding: "8px 12px",
                      borderRadius: "10px",
                      background: i === 0 ? T.surface : undefined,
                      border: "1px solid " + (i === 0 ? T.line : "transparent"),
                      fontSize: "14px",
                      fontWeight: i === 0 ? 600 : 400,
                      color: i === 0 ? T.ink : T.soft,
                      textDecoration: "none",
                    }}
                  >
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="guide-long__body" style={{ ...CARD, borderRadius: "18px" }}>
            <section id="decide" style={{ scrollMarginTop: "2rem" }}>
              <h2 style={H2_LONG}>How engines decide who to name</h2>
              <p style={SUB}>What our scans record. Nobody outside these companies can see the mechanism itself.</p>
              <p style={{ ...PROSE, marginTop: "16px" }}>
                We cannot see inside an engine. What we can see is the set of pages an answer was assembled from,
                because every scan records them beside the answer. Read enough of those and the pattern is hard to
                miss: the answer repeats a ranked list from a page the engine treats as a source, and the brand near
                the top of that list is usually the brand the answer names.
              </p>
              <p style={PROSE}>
                Topical fit appears to count for more than size. The pages behind an answer are more often narrow trade
                titles than the biggest domains in a sector. Age shows too: citation drifts down as an article gets
                older and newer pages replace it, which is why the work is a replacement cycle, not a one-off.
              </p>
            </section>
            <section id="engineer" style={{ scrollMarginTop: "2rem" }}>
              <h2 style={H2_LONG}>Can it be engineered on purpose?</h2>
              <p style={{ ...PROSE, marginTop: "16px" }}>
                Yes, and the mechanism is specific enough to write down. Identify the pages an engine already reads for
                a category - which is what the free scan does (the{" "}
                <Link href="/llm-visibility-checker" style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>LLM visibility checker</Link> runs it on your
                domain) - then secure placements on them, with the
                brand where the ranked list gets quoted from. Then structure your own pages so a reader arriving from
                the answer finds the same story.
              </p>
              <p style={PROSE}>
                The on-site half you can do yourself. The part that needs a specialist is finding the right
                publications and getting into them on merit rather than buying a slot.
              </p>
              <Link
                href="/case-studies/vibe-retail"
                style={{ marginTop: "18px", display: "flex", alignItems: "center", gap: "16px", background: T.bg, borderRadius: "14px", padding: "16px 18px", textDecoration: "none", color: T.ink }}
              >
                <div style={{ flexGrow: 1 }}>
                  <div style={MICRO}>The one worked example with a client&apos;s name on it</div>
                  <div style={{ marginTop: "4px", fontSize: "15px", fontWeight: 700 }}>Vibe Retail, with the window it happened over</div>
                </div>
                <span style={{ fontSize: "14px", fontWeight: 600, color: T.accent }}>Read it</span>
              </Link>
            </section>
            <section id="long" style={{ scrollMarginTop: "2rem" }}>
              <h2 style={H2_LONG}>How long it takes</h2>
              <p style={SUB}>Three clocks, so we do not quote one number.</p>
              <div className="guide-clocks">
                {CLOCKS.map((c) => (
                  <div key={c.label} style={{ border: "1px solid " + T.line, borderRadius: "14px", padding: "16px" }}>
                    <div style={{ ...MICRO, color: c.accent ? T.accent : T.soft }}>{c.label}</div>
                    <div style={{ marginTop: "6px", fontSize: "15px", fontWeight: 700, color: T.ink }}>{c.head}</div>
                    <div style={{ marginTop: "6px", fontSize: "13.5px", lineHeight: 1.55, color: T.soft }}>{c.body}</div>
                  </div>
                ))}
              </div>
              <p style={{ ...PROSE, marginTop: "16px" }}>
                The caveat is durability. Positions inside an answer shift as engines change what they read. Holding a
                citation needs monitoring and fresh placements, which is why this runs as a retainer.
              </p>
            </section>
          </div>
        </div>

        <section>
          <Head id="faq" title="Questions we get asked" lede="Answered here rather than on a call." />
          <div style={{ ...CARD, borderRadius: "18px", overflow: "hidden", marginTop: "16px" }}>
            {FAQS.map((f, i) => (
              <details key={f.q} open={i === 0} className="faq-row" style={{ borderBottom: "1px solid " + T.hair }}>
                <summary className="board-head faq-summary" style={{ ...GRID12, padding: "17px 26px", cursor: "pointer" }}>
                  <span style={{ gridColumn: "span 5", fontSize: "15px", fontWeight: 600, color: T.ink }}>{f.q}</span>
                  {/* Through TierText for the same reason the answers are: a
                      hint is body copy, and the pricing one names the tier the
                      published range stops at. The hints do not reach the
                      FAQPage schema, so this is the painted context only. */}
                  <span style={{ gridColumn: "span 7", fontSize: "13.5px", color: T.soft }}>
                    <TierText>{f.hint}</TierText>
                  </span>
                </summary>
                <div className="board-head" style={{ ...GRID12, padding: "0 26px 20px" }}>
                  <p style={{ gridColumn: "6 / span 7", margin: 0, fontSize: "14.5px", lineHeight: 1.7, color: T.soft }}>
                    <TierText>{f.a}</TierText>
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <DarkClosing id="aeo-close" title="Find out if the answers name you.">
          {word(QUESTIONS)} buyer questions, {word(FREE_ENGINE_COUNT).toLowerCase()} engines, every answer and every
          source.{" "}
          <Link href="/how-it-works" style={{ color: D.caret, fontWeight: 600, textDecoration: "none" }}>
            How we run the campaigns
          </Link>
        </DarkClosing>
      </div>
    </>
  );
}
