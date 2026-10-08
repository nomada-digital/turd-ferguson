import { ENGINE_SPECS, isEngine } from "../scan/engines.ts";
import { type AnswerRow, type Day, type Range, formatDay } from "./figures.ts";
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

type Answered = readonly Pick<AnswerRow, "run_date" | "answered">[] | undefined;

/**
 * Whether a day's check stored any answer (8 Oct 2026, review of audit
 * data-3). A run marked failed is not always one that read nothing: the
 * runner stores the answers before the keyword positions, so a failure after
 * that (runner.ts's catch), or the stall sweep closing a run the platform
 * killed, leaves answers that every figure counts. The answers say which it
 * was; the status alone does not.
 */
export function storedAnswers(answers: Answered, day: Day): boolean {
  return !!answers?.some((a) => a.run_date === day && a.answered);
}

/**
 * The Overview's line when today's run failed and the range ends today (8
 * Oct 2026, audit data-3 and reliability-3): a failed run was invisible - the
 * Overview read "Nothing from today's check yet", as if it were still to
 * come. `stored`: it failed after storing answers, which are in the figures,
 * so they do not stop at the last good day.
 */
export function failedTodayLine(lastGood: Day | null, stored = false): string {
  if (stored) return "Today's check did not finish, so some of today's reads may be missing.";
  return lastGood ? `Today's check failed, so the figures run to ${formatDay(lastGood)}.` : "Today's check failed, so there are no figures yet.";
}

/**
 * The same, on a range that ends before today (review of audit data-3): it
 * says what happened today and claims nothing about where the figures run to,
 * since the range shown is not today's.
 */
export function failedTodayAside(stored = false): string {
  return stored ? "Today's check did not finish." : "Today's check failed.";
}

/**
 * What the Overview says of a failed check today (review of audit data-3, 8
 * Oct 2026): the line, when the range ends today; an aside after "Last
 * checked", when it ends earlier - "the figures run to 28 Sep" under a range
 * of 5 Aug - 1 Sep claimed a day the page does not show. Null when today's
 * check did not fail.
 */
export function failedTodayNote(data: Pick<OverviewData, "lastRun"> & { runs?: readonly RunRow[]; answers?: Answered }, range: Range, today: Day): { line: string; aside: null } | { line: null; aside: string } | null {
  if (todayRun(data.runs, today)?.status !== "failed") return null;
  const stored = storedAnswers(data.answers, today);
  return range.to === today ? { line: failedTodayLine(data.lastRun?.run_date ?? null, stored), aside: null } : { line: null, aside: failedTodayAside(stored) };
}

/**
 * The note every dashboard page shows for its range (8 Oct 2026, audit data-3
 * and reliability-3). partialRunNote looked at the last run alone, so a
 * partial or failed day earlier in the range - whose reads are missing from
 * every figure - carried no note anywhere, and a failed run none at all. This
 * reads every run in the range: one lost check is named with what it lost,
 * several are listed. `skipToday` leaves today's out, for the Overview, whose
 * own line already says what today's check did. A failed day that stored
 * answers (storedAnswers, from `answers`) did not finish rather than read
 * nothing. Without run rows (the parity fixture predates them) it is
 * partialRunNote.
 */
export function runNote(data: Pick<OverviewData, "lastRun"> & { runs?: readonly RunRow[]; answers?: Answered }, range: Range, today: Day, opts: { skipToday?: boolean } = {}): string | null {
  if (!data.runs) return opts.skipToday && data.lastRun?.run_date === today ? null : partialRunNote(data.lastRun, range, today);
  const lost = data.runs
    .filter((r) => (r.status === "partial" || r.status === "failed") && r.run_date >= range.from && r.run_date <= range.to && !(opts.skipToday && r.run_date === today))
    .sort((a, b) => a.run_date.localeCompare(b.run_date));
  if (!lost.length) return null;
  if (lost.length === 1) {
    const r = lost[0]!;
    const when = r.run_date === today ? "Today's check" : `The check on ${formatDay(r.run_date)}`;
    // Review of audit data-3 (8 Oct 2026): "none came back" only when the day stored no answer.
    if (r.status === "failed")
      return storedAnswers(data.answers, r.run_date)
        ? `${when} did not finish. Any reads it did not store are left out of the figures, not counted as misses.`
        : `${when} failed: none of its reads came back, so they are left out of the figures, not counted as misses.`;
    const names = failedReadNames(r.error);
    return `${when} was partial${names.length ? ` (${and(names)})` : ""}. ${MISSING_READS}`;
  }
  const item = (r: RunRow) => `${r.run_date === today ? "today" : formatDay(r.run_date)} (${r.status === "failed" && storedAnswers(data.answers, r.run_date) ? "did not finish" : r.status})`;
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
