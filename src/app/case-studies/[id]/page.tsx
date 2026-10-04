import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OG_IMAGE } from "@/config/og";
import { ORG_REF, ld } from "@/config/schema";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { CASE_STUDY_REVALIDATE, caseStudy, longDate, publishedCaseStudies, windowOf, type CaseStudy } from "@/lib/case-studies";

/**
 * A case study published from the Nomada agency hub (see `lib/case-studies.ts`).
 *
 * Nothing on this page is typed here: headline, figures, chart and keywords
 * all come from the published study, which was frozen from the dashboards'
 * tracking, signed off by the client and published by Danny. The page's job
 * is to print every figure with its scope - the window it was measured over
 * and the method line - which is the rule `client-results.test.mts` holds the
 * attested figures to. The window opens the page and closes it, and the
 * JSON-LD description carries it too, because that string is read detached
 * from the body.
 *
 * ISR: a study published on the hub is here within `CASE_STUDY_REVALIDATE`
 * seconds without a deploy; one taken down 404s on the next re-read.
 * `/case-studies/vibe-retail` is a static folder and wins over this route.
 */

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await publishedCaseStudies()).map((s) => ({ id: s.id }));
}

const url = (id: string) => `https://alwayscited.com/case-studies/${id}`;

function standfirst(s: CaseStudy): string {
  const w = windowOf(s);
  return [s.intro, w ? `Measured ${w}.` : null].filter(Boolean).join(" ");
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const s = await caseStudy((await params).id);
  // No robots tag here: an unknown id renders not-found, which carries its own.
  if (!s) return { title: "Case study not found" };
  return {
    title: s.headline,
    description: standfirst(s).slice(0, 300),
    alternates: { canonical: url(s.id) },
    openGraph: { images: OG_IMAGE, title: `${s.headline} | alwayscited`, description: standfirst(s).slice(0, 300), url: url(s.id) },
  };
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ margin: "26px 0 0", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: "10px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.ink }}>{children}</p>
);

const pos = (p: number | null | undefined) => (p ? `#${p}` : "outside the top 100");

/** Keywords on page 1, weekly. Drawn here so the page needs no chart library. */
function Chart({ series }: { series: { d: string; p1: number }[] }) {
  const W = 640, H = 200, L = 34, B = 26, top = 12;
  const max = Math.max(1, ...series.map((x) => x.p1));
  const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : 25;
  const yMax = Math.ceil(max / step) * step;
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.p1).toFixed(1)}`).join(" ");
  const first = series[0]!, last = series[series.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Tracked keywords on Google page 1, weekly: ${first.p1} on ${longDate(first.d)}, ${last.p1} on ${longDate(last.d)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{t}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => <circle key={p.d} cx={x(i)} cy={y(p.p1)} r="3" fill={T.accent} />)}
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>
        Tracked keywords on Google page 1, one reading a week.
      </figcaption>
    </figure>
  );
}

export default async function PublishedCaseStudy({ params }: { params: Promise<{ id: string }> }) {
  const s = await caseStudy((await params).id);
  if (!s) notFound();
  const w = windowOf(s);

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: s.headline,
    description: standfirst(s),
    datePublished: s.published,
    url: url(s.id),
    author: ORG_REF,
    publisher: ORG_REF,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(articleSchema) }} />
      <div style={{ ...SHELL, paddingTop: "40px", paddingBottom: "56px", display: "flex", flexDirection: "column", gap: "26px", maxWidth: "860px" }}>
        <div>
          <div className="ac-row" style={{ ...MICRO, color: T.accent }}>
            {[s.named ? s.client : null, s.market, s.periodLabel].filter(Boolean).join(" - ")}
          </div>
          <h1 className="ac-row" style={{ margin: "10px 0 0", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
            {s.headline}
          </h1>
          {s.intro && <p className="ac-row" style={{ margin: "12px 0 0", fontSize: "16px", lineHeight: 1.65, color: T.soft }}>{s.intro}</p>}
          {w && <p className="ac-row" style={{ margin: "8px 0 0", fontSize: "13.5px", color: T.soft }}>Measured {w}.</p>}
        </div>

        {!!s.kpis?.length && (
          <div className="ac-row" style={{ display: "flex", flexWrap: "wrap", background: T.bg, border: "1px solid " + T.line, borderRadius: "14px", overflow: "hidden" }}>
            {s.kpis.map((k, i) => (
              <div key={k.l} style={{ flexGrow: 1, flexBasis: "170px", padding: "18px 20px", borderLeft: i ? "1px solid " + T.line : undefined }}>
                <div style={{ fontSize: "12.5px", color: T.soft }}>{k.l}</div>
                <div style={{ fontSize: "27px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.15, marginTop: "2px", color: T.ink }}>{k.n}</div>
                {w && <div style={{ fontSize: "12px", color: T.soft, marginTop: "5px" }}>Over {s.periodLabel ?? "the window"}</div>}
              </div>
            ))}
          </div>
        )}

        {s.series && s.series.length > 1 && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <Chart series={s.series} />
          </div>
        )}

        <div className="ac-row">
          {s.challenge && (<><H2>The starting point</H2><P>{s.challenge}</P></>)}
          {s.approach && (<><H2>What we did</H2><P>{s.approach}</P></>)}
          {s.results && (<><H2>What moved</H2><P>{s.results}</P></>)}
        </div>

        {!!s.keywords?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>Keywords that reached page 1{w ? `, ${w}` : ""}</div>
            <div style={{ marginTop: "10px" }}>
              {s.keywords.map((k) => (
                <div key={k.k} className="cs-row" style={{ borderTop: "1px solid " + T.hair }}>
                  <span style={{ fontSize: "14px", color: T.ink }}>{k.k}</span>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, flexShrink: 0, maxWidth: "100%" }}>
                    {pos(k.then)} to {pos(k.now)}
                    {k.vol ? <span style={{ fontWeight: 400, color: T.soft }}> - {k.vol.toLocaleString("en-US")} searches a month</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="ac-row">
          {s.method && <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.6, color: T.soft }}>How it was measured: {s.method}</p>}
          <p style={{ margin: "8px 0 0", fontSize: "13px", color: T.soft }}>
            Published {longDate(s.published)}. {s.named ? "Named with the client's agreement." : "The client is not named."}
          </p>
          <p style={{ margin: "14px 0 0", fontSize: "14px" }}>
            <Link href="/case-studies" style={{ color: T.accent, fontWeight: 600 }}>All case studies</Link>
          </p>
        </div>
      </div>
    </>
  );
}
