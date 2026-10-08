import { ENGINE_SPECS, isEngine } from "../scan/engines.ts";
import { type Day, type Range, formatDay } from "./figures.ts";
import type { OverviewData } from "./overview-data.ts";

/**
 * R151 (1 Oct 2026): what a screen says when the last check shown lost reads.
 * A partial run (decide.ts runOutcome) stores its failed reads unanswered, and
 * every figure skips an unanswered read, so they are left out rather than
 * counted as misses. One sentence, so the Overview and the list screens agree.
 */
export const MISSING_READS = "Some reads did not come back; they are left out of the figures, not counted as misses.";

/** The note for Clusters, Who is named and Cited pages, or null when the range holds no partial run. */
export function partialRunNote(lastRun: OverviewData["lastRun"], range: Range, today: Day): string | null {
  if (lastRun?.status !== "partial" || lastRun.run_date < range.from || lastRun.run_date > range.to) return null;
  return `${lastRun.run_date === today ? "Today's check" : `The check on ${formatDay(lastRun.run_date)}`} was partial. ${MISSING_READS}`;
}

export type RunRow = { run_date: Day; status: string; error?: string | null };

/**
 * The reads a run's error line says failed, as the dashboard names them. The
 * runner writes "4 of 21 reads failed - google_aio: 4 x HTTP 429; keyword: 1 x
 * timeout" (decide.ts failureSummary); only the engine ids are read back, never
 * the reasons, and an id this file does not know is left out.
 */
export function failedReadNames(error: string | null | undefined): string[] {
  if (!error) return [];
  const out: string[] = [];
  for (const m of error.matchAll(/(?:- |; )([a-z_]+): \d+ x /g)) {
    const id = m[1]!;
    const name = id === "keyword" ? "Google keyword positions" : isEngine(id) ? ENGINE_SPECS[id].label : null;
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

/** Today's tracking run, whatever its status, or null when none has been queued. */
export function todayRun(runs: readonly RunRow[] | undefined, today: Day): RunRow | null {
  return runs?.find((r) => r.run_date === today) ?? null;
}

/**
 * The Overview's line when today's run failed (8 Oct 2026, audit data-3 and
 * reliability-3): a failed run was invisible - the Overview read "Nothing
 * from today's check yet", as if it were still to come.
 */
export function failedTodayLine(lastGood: Day | null): string {
  return lastGood ? `Today's check failed, so the figures run to ${formatDay(lastGood)}.` : "Today's check failed, so there are no figures yet.";
}

/**
 * The note every dashboard page shows for its range (8 Oct 2026, audit data-3
 * and reliability-3). partialRunNote looked at the last run alone, so a
 * partial or failed day earlier in the range - whose reads are missing from
 * every figure - carried no note anywhere, and a failed run none at all. This
 * reads every run in the range: one lost check is named with what it lost,
 * several are listed. `skipToday` leaves today's out, for the Overview, whose
 * own line already says what today's check did. Without run rows (the parity
 * fixture predates them) it is partialRunNote.
 */
export function runNote(data: Pick<OverviewData, "lastRun"> & { runs?: readonly RunRow[] }, range: Range, today: Day, opts: { skipToday?: boolean } = {}): string | null {
  if (!data.runs) return opts.skipToday && data.lastRun?.run_date === today ? null : partialRunNote(data.lastRun, range, today);
  const lost = data.runs
    .filter((r) => (r.status === "partial" || r.status === "failed") && r.run_date >= range.from && r.run_date <= range.to && !(opts.skipToday && r.run_date === today))
    .sort((a, b) => a.run_date.localeCompare(b.run_date));
  if (!lost.length) return null;
  if (lost.length === 1) {
    const r = lost[0]!;
    const when = r.run_date === today ? "Today's check" : `The check on ${formatDay(r.run_date)}`;
    if (r.status === "failed") return `${when} failed: none of its reads came back, so they are left out of the figures, not counted as misses.`;
    const names = failedReadNames(r.error);
    return `${when} was partial${names.length ? ` (${and(names)})` : ""}. ${MISSING_READS}`;
  }
  const item = (r: RunRow) => `${r.run_date === today ? "today" : formatDay(r.run_date)} (${r.status})`;
  const shown = lost.length > 5 ? [...lost.slice(-4).map(item), `${lost.length - 4} earlier`] : lost.map(item);
  const names = [...new Set(lost.flatMap((r) => failedReadNames(r.error)))];
  return `${lost.length} checks in this range lost reads${names.length ? ` (${and(names)})` : ""}: ${and(shown)}. ${MISSING_READS}`;
}

/**
 * One cluster's "Latest answers" when a later check in the range failed (8
 * Oct 2026, audit data-3): it shows the last check with an answer, and says
 * why that is not today's. Null when no later check failed.
 */
export function latestAnswersNote(runs: readonly RunRow[] | undefined, day: Day, range: Range, today: Day): string | null {
  const failed = (runs ?? []).filter((r) => r.status === "failed" && r.run_date > day && r.run_date <= range.to).sort((a, b) => b.run_date.localeCompare(a.run_date));
  if (!failed.length) return null;
  const last = failed[0]!;
  return `${last.run_date === today ? "Today's check" : `The check on ${formatDay(last.run_date)}`} failed, so these are the answers from ${formatDay(day)}.`;
}
