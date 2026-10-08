import { ENGINE_SPECS } from "../scan/engines.ts";
import { readsFailedIn } from "./decide.ts";
import { type Day, type Range, formatDay } from "./figures.ts";
import type { OverviewData } from "./overview-data.ts";

/**
 * R151 (1 Oct 2026): what a screen says when the last check shown lost reads.
 * A partial run (decide.ts runOutcome) stores its failed reads unanswered, and
 * every figure skips an unanswered read, so they are left out rather than
 * counted as misses. One sentence, so the Overview and the list screens agree.
 */
export const MISSING_READS = "Some reads did not come back; they are left out of the figures, not counted as misses.";

/** Whether the last check shown lost reads: partial, and not only for a brand gap (decide.ts readsFailedIn). */
export function lostReads(lastRun: OverviewData["lastRun"]): boolean {
  return lastRun?.status === "partial" && readsFailedIn(lastRun.error);
}

/**
 * The note for Clusters, Who is named and Cited pages, or null when the range
 * holds no partial run. A run partial only because brand extraction failed
 * (8 Oct 2026) lost no read, so it gets brandGapNote where brands are shown
 * instead of this.
 */
export function partialRunNote(lastRun: OverviewData["lastRun"], range: Range, today: Day): string | null {
  if (!lastRun || !lostReads(lastRun) || lastRun.run_date < range.from || lastRun.run_date > range.to) return null;
  return `${lastRun.run_date === today ? "Today's check" : `The check on ${formatDay(lastRun.run_date)}`} was partial. ${MISSING_READS}`;
}

/**
 * 8 Oct 2026 (audit reliability-1 / data-6): what a brand figure says when
 * answers in its range had no other brands read (figures.ts brandGaps). Those
 * answers are left out of share of voice, Who is named and a prompt's brands,
 * not counted as naming no one - which is what they did before, silently.
 * Up to three days and engines named, then a count.
 */
export function brandGapNote(gaps: readonly { day: Day; engine: string; answers: number }[]): string | null {
  if (!gaps.length) return null;
  const n = gaps.reduce((s, g) => s + g.answers, 0);
  const label = (e: string) => (ENGINE_SPECS as Record<string, { label: string } | undefined>)[e]?.label ?? e;
  const where = gaps.slice(0, 3).map((g) => `${label(g.engine)} on ${formatDay(g.day)}`);
  const more = gaps.length > 3 ? ` and ${gaps.length - 3} more` : "";
  return `Other brands were not read in ${n.toLocaleString("en-GB")} answer${n === 1 ? "" : "s"} (${where.join(", ")}${more}), so ${n === 1 ? "it is" : "they are"} left out of the brand shares rather than counted as naming no one else.`;
}
