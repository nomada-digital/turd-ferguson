import { T } from "@/config/tokens";
import { rangeLabel } from "@/lib/tracking/date-range";
import { type Day, type Range, type Rate, formatDay } from "@/lib/tracking/figures";
import type { Compare } from "@/lib/tracking/overview-data";
import type { MonthFigures, ReportMonth } from "@/lib/tracking/report-months";

import DatePicker from "./DatePicker";

/**
 * Reports (R145, 1 Oct 2026; BRIEF-4 P5), in the Clusters page's shell as
 * Who is named and Cited pages are. Two parts: the T8 CSVs for the picked
 * range - the same files from the same route as the Overview's Download - and
 * one card per calendar month since tracking started, each the Overview's
 * reading of that month (report-months.ts). No PDF, no scheduled email.
 * Every control is a link or a download, so JS off works.
 */

const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
const CARD = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px" } as const;
const LINK = { fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" } as const;

type Kind = "answers" | "keywords" | "placements";
const FILES: Record<Kind, string> = { answers: "Answers CSV", keywords: "Keywords CSV", placements: "Placements CSV" };

function DownloadIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}

export default function Reports({
  today,
  range,
  compareMode,
  startedOn,
  reportPath,
  placed,
  months,
  note = null,
}: {
  /** Audit reliability-3 (8 Oct 2026): partial or failed checks in the picked range (run-note.ts), whose reads its CSVs leave unanswered. */
  note?: string | null;
  today: Day;
  range: Range;
  compareMode: Compare;
  startedOn: string | null;
  /** GET /api/app/[client]/report (T8). */
  reportPath: string;
  /** The placements CSV too: a placed tier, or any placement logged (the Overview's rule). */
  placed: boolean;
  months: (ReportMonth & { figures: MonthFigures })[];
}) {
  const kinds: Kind[] = placed ? ["answers", "keywords", "placements"] : ["answers", "keywords"];
  const csv = (kind: Kind, r: Range) => `${reportPath}?${new URLSearchParams({ kind, from: r.from, to: r.to })}`;
  const span = (r: Range) => (r.from === r.to ? formatDay(r.from, true) : `${formatDay(r.from)} - ${formatDay(r.to, true)}`);

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Reports</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Download any range as CSV, or a month at a time.</p>
        {note ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{note}</p> : null}
      </header>

      <section aria-labelledby="rp-range-h" style={{ ...CARD, padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 id="rp-range-h" style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>
          Download a range
        </h2>
        <div className="app-rp-range" style={{ display: "flex", alignItems: "center", gap: "16px 24px", flexWrap: "wrap" }}>
          <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn} grow={false} noCompare>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
              <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn)}</span>
              <span style={{ fontSize: "12px", color: T.soft }}>{span(range)}</span>
            </span>
          </DatePicker>
          {/* DS60 (2 Oct 2026, R173 pass 6): before the first check the range's CSVs were headers only - say when they fill instead. */}
          {!startedOn || startedOn > today ? (
            <p role="note" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
              {startedOn ? `Nothing to download yet. The first check runs at 06:00 on ${formatDay(startedOn, true)}, and the CSVs fill in from that day.` : "Nothing to download yet. The CSVs fill in from the first daily check."}
            </p>
          ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {kinds.map((k, i) => (
              <a
                key={k}
                href={csv(k, range)}
                download
                style={
                  i === 0
                    ? { display: "inline-flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", boxSizing: "border-box", borderRadius: "12px", background: T.ink, color: T.surface, fontSize: "14px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }
                    : { display: "inline-flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", boxSizing: "border-box", borderRadius: "12px", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }
                }
              >
                <DownloadIcon color={i === 0 ? T.surface : T.ink} />
                {FILES[k]}
                <span className="sr-only">{`, ${span(range)}`}</span>
              </a>
            ))}
          </div>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
          Answers: one row per prompt, engine and day - whether it answered, named you, the brands it named and the pages it cited. Keywords: each cluster keyword's Google position per day.
          {placed ? " Placements: each placement on the cluster." : ""}
        </p>
      </section>

      <section aria-labelledby="rp-months-h" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 id="rp-months-h" style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>
          Monthly
        </h2>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          {months.map((m) => {
            const f = m.figures;
            const empty = f.named.den === 0;
            return (
              <li key={m.label} aria-labelledby={`rp-${m.range.from}`} style={{ ...CARD, padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap" }}>
                  <h3 id={`rp-${m.range.from}`} style={{ margin: 0, fontSize: "18px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink, display: "flex", alignItems: "center", gap: "10px" }}>
                    {m.label}
                    {m.soFar ? <span style={{ padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: T.wash, border: `1px solid ${T.washLine}`, color: T.accent }}>So far</span> : null}
                  </h3>
                  <span style={{ fontSize: "13px", color: T.soft }}>{span(m.range)}</span>
                </div>
                {empty ? (
                  // DS24: say what fills the card, or where the readings are - the bare "No readings this month." was a dead end.
                  <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>
                    {m.soFar ? "No readings this month yet. Checks run every day at 06:00, and this card fills in from the first one." : "No readings this month, so there is nothing to download. Later months are above."}
                  </p>
                ) : (
                  <dl className="app-rp-figs" style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <dt style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Named in answers</dt>
                      <dd style={{ margin: 0, fontSize: "24px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} data-figure="named">
                        {pct(f.named)}
                      </dd>
                      <dd style={{ margin: 0, fontSize: "13px", color: T.soft }}>
                        {`${f.named.num.toLocaleString("en-GB")} of ${f.named.den.toLocaleString("en-GB")} answers`}
                        {f.lfl ? `. Like-for-like ${pct(f.lfl.now)}, ${f.lfl.delta === 0 ? "level with" : f.lfl.delta > 0 ? "up from" : "down from"} ${pct(f.lfl.before)}${f.lfl.firstWeek ? " in the first week" : ""}` : ""}
                      </dd>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <dt style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Prompts named in</dt>
                      <dd style={{ margin: 0, fontSize: "24px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} data-figure="prompts">{`${f.prompts.num} of ${f.prompts.den}`}</dd>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <dt style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>{f.basis === "clusters" ? "Cluster keywords on page 1" : "Keywords on page 1"}</dt>
                      <dd style={{ margin: 0, fontSize: "24px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} data-figure="keywords">{f.page1.den ? `${f.page1.num} of ${f.page1.den}` : "-"}</dd>
                      {/* DS57 (2 Oct 2026, R173 pass 6): a month read only from ungrouped prompts has no keyword to count, and read "0 of 0". */}
                      {f.page1.den ? null : <dd style={{ margin: 0, fontSize: "13px", color: T.soft }}>No cluster keyword checked this month</dd>}
                    </div>
                  </dl>
                )}
                {/* A month with no readings has nothing to download. */}
                {empty ? null : (
                  <div style={{ display: "flex", gap: "8px 20px", flexWrap: "wrap", borderTop: `1px solid ${T.hair}`, paddingTop: "14px" }}>
                    {kinds.map((k) => (
                      <a key={k} href={csv(k, m.range)} download style={{ ...LINK, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <DownloadIcon color={T.accent} />
                        {FILES[k]}
                        {/* R151 keyboard sweep: every month's three links read the same to a screen reader without it. */}
                        <span className="sr-only">{`, ${m.label}`}</span>
                      </a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
