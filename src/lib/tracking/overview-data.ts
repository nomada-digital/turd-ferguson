import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAllCounted } from "@/lib/supabase/page";

import { trackingDay } from "./decide.ts";
import type { LatestAnswers } from "./latest-answers.ts";
import type { Angle } from "./limits.ts";
import { type AnswerPlan, type AnswersTable, type DayPlan, type DayTable, type ReadOpts, type Structure, answerPlan, boundStated, planPrompts, readAnswerDay, readAnswers } from "./read-shape.ts";
import { type AnswerRow, type CitationRow, type Day, type Range, type SerpRow, addDays, comparisonRange } from "./figures.ts";

/**
 * Everything the overview reads for one client and one range (T4, 29 Sep
 * 2026). Paged: PostgREST caps a select at 1,000 rows, and 20 questions on
 * four engines over two 28-day periods is 4,480 answers.
 */

import type { Compare } from "./date-range.ts";
export type { Compare };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The range a URL states (BRIEF decision 3): `?from=&to=&compare=`, defaulting
 * to the last 28 days to today against the previous period. A malformed or
 * reversed range falls back to the default rather than erroring.
 */
export function rangeFrom(params: Record<string, string | string[] | undefined>, today: Day = trackingDay(), startedOn: Day | null = null): { range: Range; compare: Compare } {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const compare: Compare = one("compare") === "month" || one("compare") === "none" ? (one("compare") as Compare) : "prev";
  const from = one("from");
  const to = one("to");
  // perf-8 (8 Oct 2026): a stated from before rangeFloor starts on it; a range wholly before it is the default.
  const bounded = from && to && DAY.test(from) && DAY.test(to) && from <= to && to <= today && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to)) ? boundStated({ from, to }, today, startedOn) : null;
  if (bounded) return { range: bounded, compare };
  return { range: { from: addDays(today, -27), to: today }, compare };
}

/**
 * The range a URL states, as a query for the nav's links (R173 pass 4, DS38,
 * 2 Oct 2026): `?from=&to=&compare=`, only the parts rangeFrom would honour
 * and only when stated, so moving between pages keeps the reader's range.
 * "" when nothing is stated - the next page takes its own default.
 */
export function rangeQuery(params: Record<string, string | string[] | undefined>, today: Day = trackingDay(), startedOn: Day | null = null): string {
  const { range, compare } = rangeFrom(params, today, startedOn);
  const q = new URLSearchParams();
  if (params.from === range.from && params.to === range.to) {
    q.set("from", range.from);
    q.set("to", range.to);
  }
  if (compare !== "prev") q.set("compare", compare);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * A paged read (8 Oct 2026, audit perf-3): the first page with its count, then
 * the rest side by side (supabase/page.ts `selectAllCounted`), where every
 * page used to wait for the one before. `count` is true on the first page
 * only; pass it to `.select(columns, { count })`.
 */
async function paged<R>(query: (lo: number, hi: number, count: "exact" | undefined) => PromiseLike<{ data: R[] | null; error: { message: string } | null; count?: number | null }>, what: string): Promise<R[]> {
  try {
    return await selectAllCounted<R>((lo, hi, count) => query(lo, hi, count ? "exact" : undefined));
  } catch (err) {
    throw new Error(`could not read ${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type OverviewData = {
  /** One row per cluster (BRIEF-3; R117 T9 step, 30 Sep 2026): named for its keyword, joined through keyword_id. */
  clusters: { id: string; name: string; keyword_id: string | null; tier: string; started_on: Day; stopped_on: Day | null }[];
  questions: { id: string; text: string; added_on: Day; stopped_on: Day | null; cluster_id: string | null; angle: Angle | null }[];
  keywords: { id: string; keyword: string; added_on: Day; stopped_on: Day | null; search_volume: number | null; intent: string | null }[];
  answers: (AnswerRow & CitationRow)[];
  serp: SerpRow[];
  /** `error` is the run's failureSummary line, read only to tell a brand-only partial from lost reads (run-note.ts lostReads). */
  lastRun: { run_date: Day; status: string; finished_at: string | null; error?: string | null } | null;
  /**
   * Every run from the range's first day on, any status, newest first (8 Oct
   * 2026, audit data-3 / reliability-3): today's even when it failed or has
   * not finished, and the range's partial and failed days. lastRun reads only
   * complete and partial runs, so a failed one looked like one still to come.
   * Optional: the parity fixture predates it.
   */
  runs?: { run_date: Day; status: string; error: string | null }[];
  notes: { note_date: Day; text: string }[];
};

/**
 * The one-cluster page's answers panel (T7 part 3b, 30 Sep 2026; DB-2, 9 Oct
 * 2026): one prompt's rows, with their words, at the check the plan names -
 * `?day=`'s, or the latest with an answer on or before the range's last day.
 * The overview's read leaves `response_text` out; only this page needs the
 * words. The plan, the read and its brands_ok fallback are read-shape.ts's
 * (readAnswerDay), the same decision the fixture's shapeAnswerDay takes.
 */
export async function loadAnswerDay(clientId: string, plan: DayPlan): Promise<LatestAnswers> {
  const db = supabaseAdmin();
  return readAnswerDay((() => db.from("tracking_answers")) as unknown as DayTable, plan, clientId);
}

/**
 * "Notes on this cluster" (T7 part 4a, 30 Sep 2026): tracking_notes has no
 * cluster column, but each note may carry a question_id, so a cluster's notes
 * are those on its prompts - any date, newest first, the latest 20.
 */
export async function loadClusterNotes(clientId: string, questionIds: string[]): Promise<ClusterNote[]> {
  if (!questionIds.length) return [];
  const { data, error } = await supabaseAdmin()
    .from("tracking_notes")
    .select("note_date, text, question_id")
    .eq("client_domain_id", clientId)
    .in("question_id", questionIds)
    .order("note_date", { ascending: false })
    .limit(20);
  if (error) throw new Error(`could not read the cluster's notes: ${error.message}`);
  return (data ?? []) as ClusterNote[];
}

export type ClusterNote = { note_date: Day; text: string; question_id: string };

/**
 * The clusters, prompts and keywords alone (8 Oct 2026, audit perf-4): what
 * Settings and Setup draw, and what Placements needs to pick its cluster,
 * without a single answer read beside them.
 */
export async function loadStructure(clientId: string): Promise<Structure> {
  const db = supabaseAdmin();
  // Started together, awaited in turn: each paged read checks its own error.
  const clustersP = paged((lo, hi, count) => db.from("tracked_clusters").select("id, name, keyword_id, tier, started_on, stopped_on", { count }).eq("client_domain_id", clientId).order("started_on").range(lo, hi), "the clusters");
  const questionsP = paged((lo, hi, count) => db.from("tracked_questions").select("id, text, added_on, stopped_on, cluster_id, angle", { count }).eq("client_domain_id", clientId).order("added_on").range(lo, hi), "the questions");
  const keywordsP = paged((lo, hi, count) => db.from("tracked_keywords").select("id, keyword, added_on, stopped_on, search_volume, intent", { count }).eq("client_domain_id", clientId).order("added_on").range(lo, hi), "the keywords");
  for (const p of [clustersP, questionsP, keywordsP]) p.catch(() => {});
  return {
    clusters: (await clustersP) as OverviewData["clusters"],
    questions: (await questionsP) as OverviewData["questions"],
    keywords: (await keywordsP) as OverviewData["keywords"],
  };
}

/**
 * One client's range, shaped by `opts` (read-shape.ts, 8 Oct 2026): which
 * answer columns, only one cluster's prompts, or a structure already read.
 * Unshaped, it is every answer with its brands and citations, as before.
 */
export async function loadOverview(clientId: string, range: Range, compare: Compare, opts: ReadOpts = {}): Promise<OverviewData> {
  const db = supabaseAdmin();
  const earliest = comparisonRange(range, compare)?.from ?? range.from;
  // The columns and the prompts are read-shape.ts's decision, the one the fixture's shapeRead takes too.
  const plan = answerPlan(opts);

  // Started together, awaited in turn: each paged read checks its own error.
  const structureP = opts.structure ? Promise.resolve(opts.structure) : loadStructure(clientId);
  // Cast: tsc gives up (TS2589) matching supabase-js's builder generics to AnswersQuery's six calls. The calls are the
  // ones this read made before; read-shape.test.mts runs readAnswers on a fake PostgREST and holds it equal to shapeRead.
  const answersTable = (() => db.from("tracking_answers")) as unknown as AnswersTable;
  const answersRead = (p: AnswerPlan, ids: string[] | null) =>
    readAnswers(answersTable, p, ids, { clientId, from: earliest, to: range.to }).catch((err: unknown) => {
      throw new Error(`could not read the answers: ${err instanceof Error ? err.message : String(err)}`);
    });
  // A one-cluster read waits on the prompts for its ids: one round trip, for a tenth of the rows on a 10-cluster client.
  const answersP = plan === null ? Promise.resolve([]) : plan.cluster === null ? answersRead(plan, null) : structureP.then((s) => answersRead(plan, planPrompts(plan, s)));
  const serpP = paged(
    (lo, hi, count) =>
      db.from("tracking_serp").select("run_date, keyword_id, position", { count }).eq("client_domain_id", clientId).gte("run_date", earliest).lte("run_date", range.to).order("id").range(lo, hi),
    "the keyword positions",
  );
  // Every run from the range's first day to today, any status (audit data-3): run-note.ts runNote and failedTodayNote.
  // Counted like the reads beside it (merge with audit perf-3, 8 Oct 2026), so its one page is read once
  // (page.ts selectAllCounted) and not again to prove the end.
  const runsP = paged(
    (lo, hi, count) =>
      db.from("tracking_runs").select("run_date, status, error", { count }).eq("client_domain_id", clientId).gte("run_date", range.from).order("run_date", { ascending: false }).range(lo, hi),
    "the runs",
  );
  // A throw below must not leave these rejecting unobserved; each await still throws.
  for (const p of [structureP, answersP, serpP, runsP]) p.catch(() => {});
  const [{ data: runRows, error: runErr }, { data: noteRows, error: noteErr }] = await Promise.all([
    db.from("tracking_runs").select("run_date, status, finished_at, error").eq("client_domain_id", clientId).in("status", ["complete", "partial"]).order("run_date", { ascending: false }).limit(1),
    db.from("tracking_notes").select("note_date, text").eq("client_domain_id", clientId).gte("note_date", range.from).lte("note_date", range.to).order("note_date"),
  ]);
  if (runErr) throw new Error(`could not read the runs: ${runErr.message}`);
  if (noteErr) throw new Error(`could not read the notes: ${noteErr.message}`);
  const { clusters, questions, keywords } = await structureP;
  // Mapped in readAnswers: a column the plan left out reads as an empty list (read-shape.ts answerRow).
  const answers = await answersP;
  const serp = await serpP;
  const runs = await runsP;

  return {
    clusters,
    questions,
    keywords,
    answers,
    serp: serp as SerpRow[],
    lastRun: (runRows?.[0] as OverviewData["lastRun"]) ?? null,
    runs: runs as NonNullable<OverviewData["runs"]>,
    notes: (noteRows ?? []) as OverviewData["notes"],
  };
}
