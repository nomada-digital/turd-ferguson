import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import TwoWays from "@/components/home/TwoWays";
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

const nice = (max: number) => {
  for (const s of [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]) if (max / s <= 6) return s;
  return 250000;
};

/** A weekly line, drawn here so the page needs no chart library. */
function Chart({ series, metric = "p1", caption }: { series: { d: string; p1: number; vol?: number }[]; metric?: "p1" | "vol"; caption: string }) {
  const W = 640, H = 200, L = 52, B = 26, top = 12;
  const val = (p: { p1: number; vol?: number }) => (metric === "vol" ? p.vol ?? 0 : p.p1);
  const max = Math.max(1, ...series.map(val));
  const step = nice(max);
  const yMax = Math.ceil(max / step) * step;
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(val(p)).toFixed(1)}`).join(" ");
  const first = series[0]!, last = series[series.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`${caption} ${val(first).toLocaleString("en-US")} on ${longDate(first.d)}, ${val(last).toLocaleString("en-US")} on ${longDate(last.d)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{t.toLocaleString("en-US")}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => <circle key={p.d} cx={x(i)} cy={y(val(p))} r="3" fill={T.accent} />)}
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>{caption}</figcaption>
    </figure>
  );
}

type Pt = { d: string; p1: number; b3?: number; b10?: number; b20?: number };

/** Tracked keywords by position band, one reading a week - the dashboards' "search positions over time". */
function BandChart({ series, kw }: { series: Pt[]; kw?: number | null }) {
  const W = 640, H = 220, L = 34, B = 26, top = 12;
  const tot = (p: Pt) => (p.b3 ?? 0) + (p.b10 ?? 0) + (p.b20 ?? 0);
  const max = Math.max(1, ...series.map(tot));
  const step = nice(max);
  const yMax = Math.ceil((max * 1.08) / step) * step;   // headroom: the top band never touches the frame
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const layer = (lo: (p: Pt) => number, hi: (p: Pt) => number) =>
    series.map((p, i) => `${x(i).toFixed(1)},${y(hi(p)).toFixed(1)}`).join(" ") + " " +
    series.map((p, i) => `${x(i).toFixed(1)},${y(lo(p)).toFixed(1)}`).reverse().join(" ");
  const a = (p: Pt) => p.b3 ?? 0, b = (p: Pt) => a(p) + (p.b10 ?? 0), c = (p: Pt) => b(p) + (p.b20 ?? 0);
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const first = series[0]!, last = series[series.length - 1]!;
  const key = (o: number, t: string) => (
    <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.accent, opacity: o, marginRight: "6px" }} />{t}</span>
  );
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Tracked keywords in the top 20 by band: ${tot(first)} on ${longDate(first.d)}, ${tot(last)} on ${longDate(last.d)}, of which ${a(last)} in the top 3`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{t}</text>
          </g>
        ))}
        <polygon points={layer(b, c)} fill={T.accent} fillOpacity="0.22" />
        <polygon points={layer(a, b)} fill={T.accent} fillOpacity="0.5" />
        <polygon points={layer(() => 0, a)} fill={T.accent} fillOpacity="0.95" />
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: T.soft, marginTop: "8px" }}>
        {key(0.95, "Top 3")}{key(0.5, "4-10")}{key(0.22, "11-20")}
      </div>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>
        {kw ? `How many of the ${kw} tracked keywords sit in the top 20, by band, one reading a week.` : "Tracked keywords in the top 20, by band, one reading a week."}
      </figcaption>
    </figure>
  );
}

/** Share of the AI answers naming the brand, every full run in the window. */
function AiLine({ runs }: { runs: { d: string; pc: number; cells: number }[] }) {
  const W = 640, H = 180, L = 40, B = 26, top = 12;
  const yMax = Math.min(100, Math.max(20, Math.ceil(Math.max(...runs.map((r) => r.pc)) / 10) * 10 + 10));
  const x = (i: number) => L + (i / Math.max(1, runs.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const ticks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10).filter((t) => t % (yMax > 50 ? 20 : 10) === 0);
  const first = runs[0]!, last = runs[runs.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`AI answers naming the brand: ${first.pc}% on ${longDate(first.d)}, ${last.pc}% on ${longDate(last.d)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{t}%</text>
          </g>
        ))}
        <polyline points={runs.map((r, i) => `${x(i).toFixed(1)},${y(r.pc).toFixed(1)}`).join(" ")}
          fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {runs.map((r, i) => <circle key={r.d} cx={x(i)} cy={y(r.pc)} r="3" fill={T.accent} />)}
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>
        Share of ChatGPT, Perplexity, Gemini and Claude answers naming the brand, every full run.
      </figcaption>
    </figure>
  );
}

/** One tracked prompt: what each engine said at the start and now. */
function PromptCardView({ c }: { c: { q: string; engines: { e: string; then?: boolean | null; now: boolean; pos?: number | null; of?: number | null }[] } }) {
  const mark = (v?: boolean | null) => (v == null ? "not asked yet" : v ? "named" : "not named");
  return (
    <div style={{ border: "1px solid " + T.line, borderRadius: "12px", padding: "16px 18px", background: T.surface }}>
      <div style={{ fontSize: "14.5px", fontWeight: 600, color: T.ink }}>&ldquo;{c.q}&rdquo;</div>
      <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
        {c.engines.map((e) => (
          <div key={e.e} style={{ borderRadius: "10px", padding: "8px 10px", background: e.now ? T.wash : T.chip, border: "1px solid " + (e.now ? T.washLine : T.line) }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: e.now ? T.accent : T.soft }}>{e.e}</div>
            <div style={{ fontSize: "12px", color: T.soft, marginTop: "2px" }}>
              {e.now ? `Named${e.pos ? ` #${e.pos}${e.of ? ` of ${e.of}` : ""}` : ""}` : "Not named"}
            </div>
            <div style={{ fontSize: "11.5px", color: T.faint, marginTop: "2px" }}>At the start: {mark(e.then)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Start against now, as paired bars on one scale. */
function Bars({ rows, of, unit }: { rows: { l: string; then: number; now: number; of?: number }[]; of: number; unit: string }) {
  const pc = (n: number, d: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, d)) * 100))}%`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {rows.map((r) => (
        <div key={r.l}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: T.ink }}>
            <span>{r.l}</span>
            <span style={{ fontWeight: 600 }}>{r.then} to {r.now} <span style={{ fontWeight: 400, color: T.soft }}>of {r.of ?? of} {unit}</span></span>
          </div>
          <div aria-hidden="true" style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ height: "8px", borderRadius: "4px", background: T.chip }}>
              <div style={{ width: pc(r.then, r.of ?? of), height: "100%", borderRadius: "4px", background: T.faint }} />
            </div>
            <div style={{ height: "8px", borderRadius: "4px", background: T.chip }}>
              <div style={{ width: pc(r.now, r.of ?? of), height: "100%", borderRadius: "4px", background: T.accent }} />
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: T.soft }}>
        <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.faint, marginRight: "6px" }} />At the start</span>
        <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.accent, marginRight: "6px" }} />Now</span>
      </div>
    </div>
  );
}

function KeywordRows({ rows }: { rows: { k: string; vol?: number | null; then?: number | null; now?: number | null }[] }) {
  return (
    <div style={{ marginTop: "10px" }}>
      {rows.map((k) => (
        <div key={k.k} className="cs-row" style={{ borderTop: "1px solid " + T.hair }}>
          <span style={{ fontSize: "14px", color: T.ink }}>{k.k}</span>
          <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, flexShrink: 0, maxWidth: "100%" }}>
            {pos(k.then)} to {pos(k.now)}
            {k.vol ? <span style={{ fontWeight: 400, color: T.soft }}> - {k.vol.toLocaleString("en-US")} searches a month</span> : null}
          </span>
        </div>
      ))}
    </div>
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

        {s.compare && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "14px" }}>Google positions, start against now{w ? `, ${w}` : ""}</div>
            <Bars rows={s.compare.rows} of={s.compare.kw} unit="keywords" />
          </div>
        )}

        {s.series && s.series.length > 1 && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            {s.series.some((p) => p.b3 !== undefined)
              ? <BandChart series={s.series} kw={s.compare?.kw ?? s.tracked?.kw} />
              : <Chart series={s.series} caption="Tracked keywords on Google page 1, one reading a week." />}
          </div>
        )}

        {s.series && s.series.length > 1 && s.series.some((p) => (p.vol ?? 0) > 0) && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <Chart series={s.series} metric="vol" caption="Monthly searches for the keywords on Google page 1, one reading a week." />
          </div>
        )}

        {s.ai && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>AI visibility</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
              <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.035em", color: T.ink }}>{s.ai.pc[0]}% to {s.ai.pc[1]}%</span>
              <span style={{ fontSize: "14px", color: T.soft }}>
                of AI answers naming {s.named ? s.client : "the brand"}, {longDate(s.ai.from)} to {longDate(s.ai.to)}, across {s.ai.prompts} tracked prompts{s.engines ? ` on ${s.engines.rows.length} engines` : ""}
              </span>
            </div>
            {s.aiRuns && s.aiRuns.length > 1 && <div style={{ marginTop: "16px" }}><AiLine runs={s.aiRuns} /></div>}
          </div>
        )}

        {!!s.prompts?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "12px" }}>What the engines say now, {longDate(s.ai?.to ?? s.to ?? s.published)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {s.prompts.map((c) => <PromptCardView key={c.q} c={c} />)}
            </div>
          </div>
        )}

        {s.engines && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={{ ...MICRO, marginBottom: "14px" }}>
              AI answers naming {s.named ? s.client : "the brand"}, {longDate(s.engines.from)} against {longDate(s.engines.to)}
            </div>
            <Bars rows={s.engines.rows.map((e) => ({ l: e.e, then: e.then, now: e.now, of: e.of }))}
              of={Math.max(...s.engines.rows.map((e) => e.of))} unit="answers" />
          </div>
        )}

        <div className="ac-row">
          {s.challenge && (<><H2>The starting point</H2><P>{s.challenge}</P></>)}
          {s.approach && (<><H2>What we did</H2><P>{s.approach}</P></>)}
          {s.results && (<><H2>What moved</H2><P>{s.results}</P></>)}
        </div>

        {/* How the work gets a brand into answers: the homepage's illustrative pair, its own heading and made-up brands. */}
        <div className="ac-row" style={{ margin: "0 -24px" }}>
          <TwoWays />
        </div>

        {!!s.keywords?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>Keywords that reached page 1{w ? `, ${w}` : ""}</div>
            <KeywordRows rows={s.keywords} />
          </div>
        )}

        {!!s.movers?.length && (
          <div className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
            <div style={MICRO}>Biggest climbs{w ? `, ${w}` : ""}</div>
            <KeywordRows rows={s.movers} />
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
