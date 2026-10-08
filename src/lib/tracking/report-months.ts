import { clusterCards, clusterSummary } from "./cluster-figures.ts";
import { type Day, type Rate, type Range, keywordsIn, overview, pointsDelta, ungroupedRead } from "./figures.ts";
import type { OverviewData } from "./overview-data.ts";

/**
 * Reports' monthly cards (R145, 1 Oct 2026; BRIEF-4 P5): one per calendar
 * month since tracking started, newest first, the current month "So far".
 * Each card is the Overview's own reading of that month's range - the same
 * overview() and clusterCards/clusterSummary calls, with the Overview's
 * default comparison - so a card equals the Overview opened on that range
 * (report-months.test.mts holds it).
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type ReportMonth = { label: string; range: Range; soFar: boolean };

/** Calendar months from the one tracking started in to today's, newest first; the last one ends today. */
export function reportMonths(startedOn: Day | null, today: Day): ReportMonth[] {
  const first = (startedOn && startedOn <= today ? startedOn : today).slice(0, 7);
  const out: ReportMonth[] = [];
  let [y, m] = today.slice(0, 7).split("-").map(Number) as [number, number];
  for (let i = 0; i < 240; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym < first) break;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${ym}-${String(last).padStart(2, "0")}`;
    const soFar = end >= today;
    out.push({ label: `${MONTHS[m - 1]} ${y}`, range: { from: `${ym}-01`, to: soFar ? today : end }, soFar });
    m -= 1;
    if (m === 0) [y, m] = [y - 1, 12];
  }
  return out;
}

export type MonthFigures = {
  /** Every answer in the month naming the client. */
  named: Rate;
  /** The like-for-like reading against the comparison range, where one exists; `firstWeek` when that is the client's first week (8 Oct 2026, audit data-10). */
  lfl: { now: Rate; before: Rate; delta: number; firstWeek: boolean } | null;
  /** Prompts named in at least once, "n of m". */
  prompts: Rate;
  /** Cluster keywords on page 1 at the month's latest reading (Google keywords for an ungrouped client). */
  page1: Rate;
  /** "keywords" when the client has no clusters yet and the Overview reads flat. */
  basis: "clusters" | "keywords";
};

/** One month's figures, read exactly as the Overview reads `range` on its default comparison. */
export function monthFigures(data: OverviewData, range: Range, opts: { startedOn: Day | null; today: Day; engines: readonly string[] }): MonthFigures {
  const o = overview({ range, compare: "prev", startedOn: opts.startedOn, engines: opts.engines, questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, range) });
  const firstWeek = o.compareKind === "start";
  // The Overview's own test for reading by cluster (Overview.tsx clusterInput).
  if (data.clusters?.length && data.questions.some((q) => q.cluster_id)) {
    const cs = clusterSummary(clusterCards({ clusters: data.clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: o.compare, today: opts.today, engines: opts.engines }));
    // DS52 (R173 pass 6, 2 Oct 2026): ungrouped prompts read in the month put the Overview's headline on every
    // prompt (Overview.tsx byCluster, R177), so the card counts them too - a pilot with a cluster not yet read
    // said "No readings this month yet" over 560 answers. The keywords figure stays the cluster one, as there.
    if (ungroupedRead(data.questions, data.answers, range)) {
      const delta = o.lfl ? pointsDelta(o.lfl.now, o.lfl.before) : null;
      return { named: o.named, lfl: o.lfl && delta !== null ? { now: o.lfl.now, before: o.lfl.before, delta, firstWeek } : null, prompts: o.questions, page1: cs.page1, basis: "clusters" };
    }
    return {
      named: cs.now,
      lfl: cs.lflBefore && cs.lflDelta !== null ? { now: cs.lfl, before: cs.lflBefore, delta: cs.lflDelta, firstWeek } : null,
      prompts: cs.promptsNamed,
      page1: cs.page1,
      basis: "clusters",
    };
  }
  const delta = o.lfl ? pointsDelta(o.lfl.now, o.lfl.before) : null;
  return { named: o.named, lfl: o.lfl && delta !== null ? { now: o.lfl.now, before: o.lfl.before, delta, firstWeek } : null, prompts: o.questions, page1: o.keywords, basis: "keywords" };
}
