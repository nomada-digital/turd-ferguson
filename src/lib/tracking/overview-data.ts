import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAllCounted } from "@/lib/supabase/page";

import { trackingDay } from "./decide.ts";
import type { LatestAnswers, LatestRow } from "./latest-answers.ts";
import type { Angle } from "./limits.ts";
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
export function rangeFrom(params: Record<string, string | string[] | undefined>, today: Day = trackingDay()): { range: Range; compare: Compare } {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const compare: Compare = one("compare") === "month" || one("compare") === "none" ? (one("compare") as Compare) : "prev";
  const from = one("from");
  const to = one("to");
  if (from && to && DAY.test(from) && DAY.test(to) && from <= to && to <= today && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
    return { range: { from, to }, compare };
  }
  return { range: { from: addDays(today, -27), to: today }, compare };
}

/**
 * The range a URL states, as a query for the nav's links (R173 pass 4, DS38,
 * 2 Oct 2026): `?from=&to=&compare=`, only the parts rangeFrom would honour
 * and only when stated, so moving between pages keeps the reader's range.
 * "" when nothing is stated - the next page takes its own default.
 */
export function rangeQuery(params: Record<string, string | string[] | undefined>, today: Day = trackingDay()): string {
  const { range, compare } = rangeFrom(params, today);
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
  lastRun: { run_date: Day; status: string; finished_at: string | null } | null;
  notes: { note_date: Day; text: string }[];
};

/**
 * "Latest answers" (T7 part 3b, 30 Sep 2026): one prompt's rows at its latest
 * check on or before `to` - at most one per engine, so two small reads and
 * no paging. The overview's read leaves `response_text` out; only this page
 * needs the words.
 */
export async function loadLatestAnswers(clientId: string, questionId: string, to: Day): Promise<LatestAnswers> {
  const db = supabaseAdmin();
  const { data: last, error: lastErr } = await db
    .from("tracking_answers")
    .select("run_date")
    .eq("client_domain_id", clientId)
    .eq("question_id", questionId)
    .lte("run_date", to)
    .order("run_date", { ascending: false })
    .limit(1);
  if (lastErr) throw new Error(`could not read the latest check: ${lastErr.message}`);
  const day = (last?.[0]?.run_date as Day | undefined) ?? null;
  if (!day) return { day: null, rows: [] };
  const { data, error } = await db
    .from("tracking_answers")
    .select("engine, answered, named, response_text, brands, citations, created_at")
    .eq("client_domain_id", clientId)
    .eq("question_id", questionId)
    .eq("run_date", day);
  if (error) throw new Error(`could not read the latest answers: ${error.message}`);
  return {
    day,
    rows: ((data ?? []) as Record<string, unknown>[]).map((a) => ({
      engine: a.engine as string,
      answered: a.answered as boolean,
      named: a.named as boolean,
      text: typeof a.response_text === "string" ? a.response_text : null,
      brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
      citations: Array.isArray(a.citations) ? (a.citations as LatestRow["citations"]) : [],
      at: typeof a.created_at === "string" ? a.created_at : null,
    })),
  };
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

export async function loadOverview(clientId: string, range: Range, compare: Compare): Promise<OverviewData> {
  const db = supabaseAdmin();
  const earliest = comparisonRange(range, compare)?.from ?? range.from;

  // Started together, awaited in turn: each paged read checks its own error.
  const clustersP = paged((lo, hi, count) => db.from("tracked_clusters").select("id, name, keyword_id, tier, started_on, stopped_on", { count }).eq("client_domain_id", clientId).order("started_on").range(lo, hi), "the clusters");
  const questionsP = paged((lo, hi, count) => db.from("tracked_questions").select("id, text, added_on, stopped_on, cluster_id, angle", { count }).eq("client_domain_id", clientId).order("added_on").range(lo, hi), "the questions");
  const keywordsP = paged((lo, hi, count) => db.from("tracked_keywords").select("id, keyword, added_on, stopped_on, search_volume, intent", { count }).eq("client_domain_id", clientId).order("added_on").range(lo, hi), "the keywords");
  const answersP = paged(
    (lo, hi, count) =>
      db
        .from("tracking_answers")
        .select("run_date, question_id, engine, answered, named, brands, citations", { count })
        .eq("client_domain_id", clientId)
        .gte("run_date", earliest)
        .lte("run_date", range.to)
        .order("id")
        .range(lo, hi),
    "the answers",
  );
  const serpP = paged(
    (lo, hi, count) =>
      db.from("tracking_serp").select("run_date, keyword_id, position", { count }).eq("client_domain_id", clientId).gte("run_date", earliest).lte("run_date", range.to).order("id").range(lo, hi),
    "the keyword positions",
  );
  // A throw below must not leave these rejecting unobserved; each await still throws.
  for (const p of [clustersP, questionsP, keywordsP, answersP, serpP]) p.catch(() => {});
  const [{ data: runRows, error: runErr }, { data: noteRows, error: noteErr }] = await Promise.all([
    db.from("tracking_runs").select("run_date, status, finished_at").eq("client_domain_id", clientId).in("status", ["complete", "partial"]).order("run_date", { ascending: false }).limit(1),
    db.from("tracking_notes").select("note_date, text").eq("client_domain_id", clientId).gte("note_date", range.from).lte("note_date", range.to).order("note_date"),
  ]);
  if (runErr) throw new Error(`could not read the runs: ${runErr.message}`);
  if (noteErr) throw new Error(`could not read the notes: ${noteErr.message}`);
  const clusters = await clustersP;
  const questions = await questionsP;
  const keywords = await keywordsP;
  const answers = await answersP;
  const serp = await serpP;

  return {
    clusters: clusters as OverviewData["clusters"],
    questions: questions as OverviewData["questions"],
    keywords: keywords as OverviewData["keywords"],
    answers: (answers as Record<string, unknown>[]).map((a) => ({
      run_date: a.run_date as Day,
      question_id: a.question_id as string,
      engine: a.engine as string,
      answered: a.answered as boolean,
      named: a.named as boolean,
      brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
      citations: Array.isArray(a.citations) ? (a.citations as CitationRow["citations"]) : [],
    })),
    serp: serp as SerpRow[],
    lastRun: (runRows?.[0] as OverviewData["lastRun"]) ?? null,
    notes: (noteRows ?? []) as OverviewData["notes"],
  };
}
