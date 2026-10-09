import Link from "@/components/app/AppLink";

import EngineLogo from "@/components/EngineLogo";
import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { clusterCards } from "@/lib/tracking/cluster-figures";
import { rangeLabel } from "@/lib/tracking/date-range";
import { type CitedPageRow, type Day, type Range, type Rate, basis as basisLine, brandGaps, comparisonLabel, firstCheckDay, formatDay, firstReadComplete, resolveComparison, ungroupedRead } from "@/lib/tracking/figures";
import { NAMED_TOP, citedWithBrand, namedPage } from "@/lib/tracking/named-figures";
import { answerHref, namedEvidence } from "@/lib/tracking/evidence";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import { brandGapNote, runNote } from "@/lib/tracking/run-note";

import ChipRow from "./ChipRow";
import DatePicker from "./DatePicker";
import { Chip } from "./Overview";
import { ClearFilters, ClearSearch } from "./ClearLinks";
import { appPath } from "@/lib/app-host";

/**
 * Who is named (R143, 1 Oct 2026; BRIEF-4 P3): the full page of the
 * Overview's "Who is named instead" panel (boards-3/Main.dc.html), in the
 * Clusters page's shell - title block, date picker, filter row, one bordered
 * list at 18px. Every figure is named-figures.ts, which is the panel's own
 * brandBoard narrowed by the filters. Filters, "Show all" and the one-open
 * accordion are links (`?cluster=&engine=&all=1&open=`), with from/to/compare
 * kept, so the whole page works with JS off. DS21 (2 Oct 2026): `?q=`
 * searches brand names, a GET form like Clusters'. DB-2 (9 Oct 2026): each
 * prompt under an open row opens the latest answer in the range that named
 * the brand, on its day and engine (evidence.ts namedEvidence).
 */

const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
const HEAD = { fontSize: "12px", fontWeight: 600, color: T.soft } as const;
const GRID = "minmax(0, 1fr) 96px 84px 96px 120px 76px";
const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;

export default function Named({
  brand,
  domain,
  engines,
  today,
  range,
  compareMode,
  startedOn,
  data,
  slug,
  cluster,
  engine,
  all,
  open,
  q,
}: {
  brand: string;
  /** The client's site, to mark its own pages among those cited. */
  domain: string;
  engines: readonly Engine[];
  today: Day;
  range: Range;
  compareMode: Compare;
  startedOn: string | null;
  data: OverviewData;
  slug: string;
  /** A cluster id from the URL, or null for all. Unknown ids are dropped by the page. */
  cluster: string | null;
  engine: Engine | null;
  all: boolean;
  open: string | null;
  /** DS21: the search, already cut to APP_LIMITS.search; matches the brand's name. */
  q: string;
}) {
  // 8 Oct 2026 (audit data-10): the comparison the Overview reads - the first week for a young client.
  // The first week's first day, from started_on and the prompts - the date picker is handed the same day.
  const firstCheck = firstCheckDay(startedOn, data.questions);
  // ON-3 review (9 Oct 2026): a first reading only when its check was complete.
  const firstComplete = firstReadComplete(data.runs, firstCheck);
  const cmp = resolveComparison(range, compareMode, startedOn, firstCheck, firstComplete);
  const before = cmp.range;
  // Audit data-3 (8 Oct 2026): every partial or failed check in the range, not only the last.
  const partial = runNote(data, range, today);
  const cards = clusterCards({ clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today, engines });
  const picked = cluster ? cards.find((c) => c.id === cluster) ?? null : null;
  const only = picked ? new Set(picked.prompts.map((p) => p.id)) : null;
  const page = namedPage({ answers: data.answers, range, before, you: brand, only, engine });
  // 8 Oct 2026 (audit data-6): namedPage leaves out answers whose other brands were not read; say so, for the same filters.
  const gapNote = brandGapNote(brandGaps(data.answers.filter((a) => (!only || only.has(a.question_id)) && (!engine || a.engine === engine)), range));

  // Each prompt's cluster keyword and its place on the one-cluster page (`?prompt=` is that index).
  const where = new Map<string, { clusterId: string; keyword: string; index: number }>();
  for (const c of cards) c.prompts.forEach((p, i) => where.set(p.id, { clusterId: c.id, keyword: c.keyword ?? c.name, index: i }));
  const text = new Map(data.questions.map((q) => [q.id, q.text]));

  const base: Record<string, string> = { from: range.from, to: range.to, ...(compareMode === "prev" ? {} : { compare: compareMode }) };
  const term = q.trim().toLowerCase();
  const rows = term ? page.rows.filter((r) => r.name.toLowerCase().includes(term)) : page.rows;
  const state = { ...base, ...(picked ? { cluster: picked.id } : {}), ...(engine ? { engine } : {}), ...(term ? { q } : {}), ...(all ? { all: "1" } : {}) };
  const href = (over: Record<string, string | null>) => {
    const q: Record<string, string> = { ...state };
    for (const [k, v] of Object.entries(over)) if (v === null) delete q[k];
    else q[k] = v;
    return `?${new URLSearchParams(q)}`;
  };
  const clusterPath = (id: string) => appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(id)}`);

  const shown = all ? rows : rows.slice(0, NAMED_TOP);
  const clustersCounted = picked ? 1 : cards.filter((c) => c.prompts.some((p) => p.now.den > 0)).length;
  // DS53 (R173 pass 6, 2 Oct 2026): ungrouped prompts' answers are in the count, so say so as the Overview does
  // (Overview.tsx `across`) - a pilot with a cluster not yet read had "560 answers in 0 clusters".
  const loose = picked || !cards.length ? 0 : ungroupedRead(data.questions, data.answers, range);
  const looseWords = `${loose} ungrouped prompt${loose === 1 ? "" : "s"}`;
  // Audit mobile-4 (8 Oct 2026): a picked cluster read "in 1 cluster" and an engine not at all, so a
  // shared link to ?cluster=c8 - whose chip loads out of sight on a phone - looked like the whole account.
  const inWhat = picked ? `the "${picked.keyword ?? picked.name}" cluster` : !cards.length ? "" : loose && !clustersCounted ? looseWords : `${clustersCounted} cluster${clustersCounted === 1 ? "" : "s"}${loose ? ` and ${looseWords}` : ""}`;
  const onlyEngine = engine ? `, ${ENGINE_SPECS[engine].label} only` : "";
  const headline = page.answers
    ? `${term ? `${rows.length} of ${page.rows.length} brands match "${q.trim()}", named` : `${page.brands} brand${page.brands === 1 ? "" : "s"} named`} across ${page.answers.toLocaleString("en-GB")} answers${inWhat ? ` in ${inWhat}` : ""}${onlyEngine}.`
    : null;
  const filtered = Boolean(picked || engine || term);

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Who is named</h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Every brand the engines name in answers to your prompts, with its share of every brand mention.</p>
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
          {gapNote ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{gapNote}</p> : null}
        </div>
        <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn} firstCheck={firstCheck} firstComplete={firstComplete} grow={false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn)}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>
              {formatDay(range.from)} - {formatDay(range.to, true)}
              {before ? `, ${comparisonLabel(before, cmp.kind)}` : ""}
            </span>
          </span>
        </DatePicker>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {cards.length ? (
          <ChipRow label="Filter by cluster" current={picked?.id ?? ""}>
            <Link href={href({ cluster: null, open: null })} aria-current={!picked ? "true" : undefined} style={PILL(!picked)}>
              All clusters
            </Link>
            {cards.map((c) => (
              <Link key={c.id} href={href({ cluster: c.id, open: null })} aria-current={picked?.id === c.id ? "true" : undefined} style={PILL(picked?.id === c.id)}>
                {c.keyword ?? c.name}
              </Link>
            ))}
          </ChipRow>
        ) : null}
        <ChipRow label="Filter by engine" current={engine ?? ""}>
          <Link href={href({ engine: null, open: null })} aria-current={!engine ? "true" : undefined} style={PILL(!engine)}>
            All engines
          </Link>
          {engines.map((e) => (
            <Link key={e} href={href({ engine: e, open: null })} aria-current={engine === e ? "true" : undefined} style={PILL(engine === e)}>
              <EngineLogo engine={e} size={16} />
              {ENGINE_SPECS[e].label}
            </Link>
          ))}
        </ChipRow>
        <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "320px", maxWidth: "100%", height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
          <input id="nm-from" type="hidden" name="from" value={range.from} />
          <input id="nm-to" type="hidden" name="to" value={range.to} />
          {compareMode === "prev" ? null : <input id="nm-compare" type="hidden" name="compare" value={compareMode} />}
          {picked ? <input id="nm-cluster" type="hidden" name="cluster" value={picked.id} /> : null}
          {engine ? <input id="nm-engine" type="hidden" name="engine" value={engine} /> : null}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <label htmlFor="nm-search" className="sr-only">
            Search brands
          </label>
          {/* Audit mobile-6 (8 Oct 2026): a search key on the phone's keyboard, and brand names left as typed rather than autocorrected. */}
          <input id="nm-search" type="search" name="q" defaultValue={q} maxLength={APP_LIMITS.search} placeholder="Search brands" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "14px", color: T.ink, background: "transparent" }} />
          {term ? <ClearSearch href={href({ q: null, open: null })} /> : null}
        </form>
      </div>

      <section aria-labelledby="nm-h" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px", flexWrap: "wrap", padding: "18px 24px 14px" }}>
          <h2 id="nm-h" style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>
            {headline ?? (picked || engine ? `No answers in this range${picked ? ` in the "${picked.keyword ?? picked.name}" cluster` : ""}${onlyEngine}.` : "No answers in this range yet.")}
          </h2>
          {filtered ? <ClearFilters href={`?${new URLSearchParams(base)}`} /> : null}
        </div>
        {headline ? (
          <>
            <div className="app-nm-grid app-hide-sm" style={{ display: "grid", gridTemplateColumns: GRID, gap: "16px", padding: "10px 24px", borderTop: `1px solid ${T.line}` }}>
              <span style={HEAD}>Brand</span>
              <span style={{ ...HEAD, textAlign: "right" }}>Answers</span>
              <span style={{ ...HEAD, textAlign: "right" }}>Share</span>
              <span style={{ ...HEAD, textAlign: "right" }}>{before ? (cmp.kind === "start" ? "Vs first week" : cmp.kind === "first" ? "Vs first reading" : "Vs last period") : "Change"}</span>
              <span style={HEAD}>Engines</span>
              <span style={{ ...HEAD, textAlign: "right" }}>Prompts</span>
            </div>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((r) => {
                const isOpen = open === r.key;
                // DB-2: per prompt, the answer each prompt link opens - the latest in range naming this brand, on these filters.
                const opens = isOpen ? namedEvidence({ answers: data.answers, range, key: r.key, you: brand, only, engine, engines }) : null;
                return (
                  <li key={r.key} style={{ borderTop: `1px solid ${T.line}`, background: r.you ? T.wash : undefined }}>
                    <Link href={href({ open: isOpen ? null : r.key })} scroll={false} aria-expanded={isOpen} className="app-nm-grid" style={{ display: "grid", gridTemplateColumns: GRID, gap: "16px", alignItems: "center", padding: "14px 24px", color: T.ink, textDecoration: "none" }}>
                      <span className="app-nm-name" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, fontSize: "14px", fontWeight: r.you ? 700 : 600, color: r.you ? T.accent : T.ink }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: isOpen ? "rotate(90deg)" : undefined }}>
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span style={{ overflowWrap: "break-word", minWidth: 0 }}>{r.name}</span>
                        {r.you ? <span style={{ padding: "1px 8px", borderRadius: "999px", background: T.surface, border: `1px solid ${T.washLine}`, fontSize: "11px", fontWeight: 700, color: T.ink }}>You</span> : null}
                      </span>
                      <span className="app-hide-sm" style={{ textAlign: "right", fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {r.answers.toLocaleString("en-GB")}
                      </span>
                      {/* DS46 (2 Oct 2026): share stays on a phone - the page, its footnote and the pts chip beside it are about share; answers move under it. */}
                      <span style={{ textAlign: "right", fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }} title={basisLine(r.share, "mentions")}>
                        {pct(r.share)}
                      </span>
                      <span className="app-nm-change" style={{ display: "flex", justifyContent: "flex-end" }}>
                        {r.isNew ? <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>New</span> : before && r.answers ? <Chip value={r.delta} unit=" pts" none="-" vs={before ? comparisonLabel(before, cmp.kind) : null} /> : null}
                      </span>
                      {/* Two grid cells on a desktop; one line on a phone, so the counts never overlap the engines. */}
                      <span className="app-nm-sub" style={{ display: "contents" }}>
                        <span className="app-nm-engines" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          {engines.map((e) => (
                            <span key={e} style={{ display: "inline-flex", opacity: r.engines.includes(e) ? 1 : 0.22 }}>
                              <EngineLogo engine={e} size={16} title={`${ENGINE_SPECS[e].label}${r.engines.includes(e) ? " named" : " did not name"} ${r.name}`} />
                            </span>
                          ))}
                        </span>
                        <span className="app-nm-prompts" style={{ textAlign: "right", fontSize: "13px", color: T.soft, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          <span className="app-show-sm" style={{ whiteSpace: "nowrap" }}>{`${r.answers.toLocaleString("en-GB")} answer${r.answers === 1 ? "" : "s"},`}</span>
                          <span className="app-show-sm"> </span>
                          <span style={{ whiteSpace: "nowrap" }}>{`${r.prompts.length} prompt${r.prompts.length === 1 ? "" : "s"}`}</span>
                        </span>
                      </span>
                    </Link>
                    {/* First in the open row: a rival can be named in dozens of prompts, and these pages are the question asked (task 8). */}
                    {isOpen ? <CitedWith rows={citedWithBrand({ answers: data.answers, range, key: r.key, you: brand, domain, only, engine })} name={r.you ? "you" : r.name} /> : null}
                    {isOpen ? (
                      r.prompts.length ? (
                        <ul style={{ listStyle: "none", margin: 0, padding: "0 24px 16px 44px", display: "flex", flexDirection: "column", gap: "2px" }}>
                          {r.prompts.map((p) => {
                            const w = where.get(p.id);
                            return (
                              <li key={p.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${T.hair}` }}>
                                <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 320px" }}>
                                  {w ? (
                                    <Link href={answerHref(clusterPath(w.clusterId), { ...base, prompt: String(w.index) }, opens?.get(p.id))} style={{ fontSize: "14px", fontWeight: 600, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>
                                      {text.get(p.id) ?? "A stopped prompt"}
                                    </Link>
                                  ) : (
                                    <span style={{ fontSize: "14px", fontWeight: 600, overflowWrap: "anywhere" }}>{text.get(p.id) ?? "A stopped prompt"}</span>
                                  )}
                                  {w ? <span style={{ fontSize: "12px", color: T.soft }}>{w.keyword}</span> : null}
                                </span>
                                <span style={{ fontSize: "13px", color: T.soft, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{`Named ${p.daysNamed} of ${p.daysAnswered} day${p.daysAnswered === 1 ? "" : "s"} answered`}</span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, padding: "0 24px 16px 44px", fontSize: "13px", color: T.soft }}>{r.you ? "No answer named you in this range." : "Not named in this range."}</p>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {!rows.length ? <p style={{ margin: 0, padding: "14px 24px 20px", borderTop: `1px solid ${T.line}`, fontSize: "14px", color: T.soft }}>{`No brand named in this range matches "${q.trim()}". Clear the search or try part of a name.`}</p> : null}
            {!all && rows.length > NAMED_TOP ? (
              <div style={{ borderTop: `1px solid ${T.line}`, padding: "14px 24px" }}>
                <Link href={href({ all: "1" })} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  {`Show all ${rows.length}`}
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, padding: "0 24px 20px", fontSize: "14px", color: T.soft }}>
            {picked || engine ? "No answers match these filters in this range. Clear a filter or pick another range." : "The figures fill in from the first daily check."}
          </p>
        )}
      </section>
      <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft, maxWidth: "820px" }}>
        Share is a brand&apos;s mentions out of every brand mention in these answers; one answer naming a brand is one mention. Change is in points against the comparison period.
      </p>
    </div>
  );
}

/** R173 pass 2: the pages cited in the answers naming this brand, as text - never a link to someone else's page, as Cited pages. */
function CitedWith({ rows, name }: { rows: CitedPageRow[]; name: string }) {
  if (!rows.length) return null;
  return (
    <div style={{ padding: "0 24px 16px 44px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: T.soft }}>{`Pages cited in answers that name ${name}`}</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((p) => (
          <li key={p.page} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${T.hair}` }}>
            <span style={{ fontSize: "14px", overflowWrap: "anywhere", minWidth: 0, flex: "1 1 260px" }}>
              {p.page}
              {p.yours ? <span style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 600, color: T.accent }}>Your site</span> : null}
            </span>
            <span style={{ fontSize: "13px", color: T.soft, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{`Cited ${p.count} time${p.count === 1 ? "" : "s"}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
