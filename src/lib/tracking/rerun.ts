import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { TRACKING_STALL_MS, missingColumn } from "./decide.ts";
import { runIsStalled } from "./dispatch.ts";

/**
 * Re-running a day's failed reads (9 Oct 2026, audit reliability-4).
 *
 * Before this a failed, partial or killed run could never be read again: "Run
 * now" refused anything not queued, the runner's claim moves only queued to
 * running, and (client, run_date) is unique. Pilot history says retryable
 * failure is common - 10 of 22 runs from 30 Sep to 8 Oct finished partial,
 * most on google_aio (verifier read, 8 Oct 2026) - and a day not read is a day the dashboard can never
 * show.
 *
 * So "Run now" on today's failed, partial or stalled run moves it back to
 * queued with a compare-and-swap (reopenRun) and dispatches it down the same
 * signed path as the cron. The runner claims it as it claims any run, under
 * the same tracking_enabled switch and daily cost cap, and reads again only
 * what did not come back (retryAnswers, retryKeywords): an answer with no row,
 * one that came back unanswered, or one whose other brands were not read; a
 * keyword with no position stored. What did come back is left as it was read.
 *
 * Unanswered includes a SERP with no AI Overview, which is a silence and not
 * a failure. The rows cannot tell the two apart - a failed read is stored
 * answered=false with no text, as a silence is - so a re-run asks both again
 * rather than guess, and a re-read that fails leaves the row it found in
 * place (keepsOld) and counts as a failed read. That over-counts, never
 * under-counts: the error line never calls a read good that was not re-read.
 *
 * Only today's run. A reading is dated by its run's run_date, and a read made
 * tomorrow stored under today would be a backfill the dashboard cannot tell
 * from a reading.
 *
 * A re-run never leaves the day worse than it found it. The marker it carries
 * in step_ms (nothing reads tracking_runs.step_ms) holds the status and error
 * line it was reopened from, and a re-run the cap refuses or that throws is
 * closed back to them (restored). It also holds whether an earlier pass of
 * the run landed, so first_reading - sent after a client's first run that did
 * not fail - is not sent twice for one day.
 *
 * Loadable by node --test: relative imports, no server-only, the database
 * passed in (rerun.test.mts runs it against an in-memory one).
 */

export type RerunOf = "failed" | "partial" | "stalled";

/** What a reopened run carries in step_ms, from the reopen until it is reopened again. */
export type RerunMarker = {
  /** The status it was reopened from; a stalled run is one left `running`. */
  of: RerunOf;
  /** Its error line then, to restore if the re-run is refused or throws. */
  error: string | null;
  /** When it was reopened. */
  at: string;
  /** How many times this run has been reopened. */
  n: number;
  /** Whether a pass of this run already closed not failed, so first_reading was considered then. */
  landed: boolean;
};

/** The marker on a claimed run's step_ms, or null on the cron's first pass (or anything unreadable). */
export function rerunMarker(stepMs: unknown): RerunMarker | null {
  const m = (stepMs as { rerun?: unknown } | null)?.rerun as Partial<RerunMarker> | undefined;
  if (!m || typeof m !== "object") return null;
  if (m.of !== "failed" && m.of !== "partial" && m.of !== "stalled") return null;
  return {
    of: m.of,
    error: typeof m.error === "string" ? m.error : null,
    at: typeof m.at === "string" ? m.at : "",
    n: typeof m.n === "number" && Number.isFinite(m.n) ? m.n : 1,
    landed: m.landed === true,
  };
}

export type RunForRerun = {
  id: string;
  run_date: string;
  status: string;
  error: string | null;
  started_at: string | null;
  step_ms?: unknown;
};

const hhmm = (iso: string | null) => (iso ? `${iso.slice(11, 16)}Z` : "an unknown time");

/**
 * Whether a run that is not queued may be re-run, and from what. Queued runs
 * are "Run now"'s first path, which dispatches without reopening anything.
 */
export function rerunVerdict(run: RunForRerun, today: string, now: number = Date.now()): { ok: true; of: RerunOf } | { ok: false; message: string } {
  if (run.run_date !== today) return { ok: false, message: "Only today's run can be re-run: a reading is dated the day it is read." };
  if (run.status === "failed" || run.status === "partial") return { ok: true, of: run.status };
  if (run.status === "running") {
    if (runIsStalled(run, now)) return { ok: true, of: "stalled" };
    return { ok: false, message: `Today's run is running (since ${hhmm(run.started_at)}). It can be re-run once it ends, or after ${TRACKING_STALL_MS / 60_000} minutes if it never does.` };
  }
  return { ok: false, message: `Today's run is already ${run.status}.` };
}

/** The marker a reopen writes: the run as it was, counted, with landed carried forward. */
export function nextMarker(run: RunForRerun, of: RerunOf, now: number = Date.now()): RerunMarker {
  const prev = rerunMarker(run.step_ms);
  return {
    of,
    error: of === "stalled" ? (run.error ?? "the run was stopped before it could record a result") : run.error,
    at: new Date(now).toISOString(),
    n: (prev?.n ?? 0) + 1,
    landed: of === "partial" || prev?.landed === true,
  };
}

/**
 * Move a failed, partial or stalled run back to queued, so the run route's
 * claim takes it. A compare-and-swap on the status read, and for a running
 * row on a start older than TRACKING_STALL_MS as well, so a run that is
 * genuinely still reading - or that was claimed again a moment ago - is never
 * reopened under itself. True when this call moved the row.
 */
export async function reopenRun(db: SupabaseClient, run: RunForRerun, of: RerunOf, now: number = Date.now()): Promise<boolean> {
  const reopen = { status: "queued", error: null, step_ms: { rerun: nextMarker(run, of, now) } };
  const stalledBefore = new Date(now - TRACKING_STALL_MS).toISOString();
  const { data, error } = await (run.status === "running"
    ? db.from("tracking_runs").update(reopen).eq("id", run.id).eq("status", "running").lt("started_at", stalledBefore).select("id")
    : db.from("tracking_runs").update(reopen).eq("id", run.id).eq("status", run.status).select("id"));
  if (error) throw new Error(`could not reopen run ${run.id}: ${error.message}`);
  return (data ?? []).length === 1;
}

/** How a re-run is closed when it read nothing it can stand behind: the status and line it was reopened from, with why. */
export function restored(m: RerunMarker, why: string): { status: "failed" | "partial"; error: string } {
  return { status: m.of === "partial" ? "partial" : "failed", error: [m.error, why].filter(Boolean).join(" - ").slice(0, 500) };
}

/** A stored answer of the run being re-run, as much of it as the re-run needs. */
export type KeptAnswer = {
  run_date: string;
  question_id: string;
  engine: string;
  answered: boolean;
  named: boolean;
  brands: string[];
  /** Absent when tracking_answers has no brands_ok column yet (20261008020000 not applied), as figures.ts AnswerRow reads it. */
  brands_ok?: boolean;
};

export type KeptSerp = { run_date: string; keyword_id: string; position: number | null };

/** What the run already stored, read before a re-run asks anything. */
export type Kept = { answers: KeptAnswer[]; serp: KeptSerp[] };

export const jobKey = (questionId: string, engine: string) => `${questionId} ${engine}`;

/**
 * The run's stored answers and keyword positions, every page of each. A
 * deploy can land before 20261008020000, so a select naming brands_ok goes
 * again without it, as read-shape.ts readAnswers does.
 */
export async function readKept(db: SupabaseClient, runId: string): Promise<Kept> {
  let raw: Record<string, unknown>[];
  try {
    raw = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands, brands_ok").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    if (!missingColumn(err, "brands_ok")) throw new Error(`could not read the run's answers: ${err instanceof Error ? err.message : String(err)}`);
    raw = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("tracking_answers").select("run_date, question_id, engine, answered, named, brands").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
    );
  }
  const serp = await selectAll<Record<string, unknown>>((from, to) =>
    db.from("tracking_serp").select("run_date, keyword_id, position").eq("run_id", runId).order("id", { ascending: true }).range(from, to),
  );
  return {
    answers: raw.map((a) => ({
      run_date: a.run_date as string,
      question_id: a.question_id as string,
      engine: a.engine as string,
      answered: a.answered === true,
      named: a.named === true,
      brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
      ...(typeof a.brands_ok === "boolean" ? { brands_ok: a.brands_ok } : {}),
    })),
    serp: serp.map((s) => ({ run_date: s.run_date as string, keyword_id: s.keyword_id as string, position: typeof s.position === "number" ? s.position : null })),
  };
}

/**
 * The engines a run's error line says brand extraction missed - "brand
 * extraction failed - chatgpt: other brands not read in 12 of 20 answers"
 * (decide.ts failureSummary). Read only when the rows cannot say it
 * themselves, before brands_ok exists.
 */
export function brandGapEngines(error: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const at = error ? error.indexOf("brand extraction failed") : -1;
  if (at < 0) return out;
  for (const m of error!.slice(at).matchAll(/(?:- |; )([a-z_]+): other brands not read/g)) out.add(m[1]!);
  return out;
}

/**
 * Which answers a re-run asks again. Every (prompt, engine) of the day is
 * asked unless the run holds a row for it that came back answered with its
 * other brands read. Without the brands_ok column, the engines the error line
 * names as a brand gap are asked again whole, since no row can say which of
 * their answers were missed.
 */
export function retryAnswers(kept: Kept, priorError: string | null): (questionId: string, engine: string) => boolean {
  const noColumn = kept.answers.some((a) => a.brands_ok === undefined);
  const gapEngines = noColumn ? brandGapEngines(priorError) : new Set<string>();
  const good = new Set(
    kept.answers.filter((a) => a.answered && a.brands_ok !== false && !gapEngines.has(a.engine)).map((a) => jobKey(a.question_id, a.engine)),
  );
  return (questionId, engine) => !good.has(jobKey(questionId, engine));
}

/** Which keywords a re-run reads again: those with no position stored, which is how a failed keyword read is left. */
export function retryKeywords(kept: Kept): (keywordId: string) => boolean {
  const stored = new Set(kept.serp.map((s) => s.keyword_id));
  return (keywordId) => !stored.has(keywordId);
}

/** A re-read that failed again leaves the row the run already holds; only the cron's first pass, with nothing kept, writes a failed read. */
export function keepsOld(kept: Kept | null, a: { question_id: string; engine: string; failed: boolean }): boolean {
  if (!kept || !a.failed) return false;
  return kept.answers.some((k) => k.question_id === a.question_id && k.engine === a.engine);
}

/**
 * The day's rows once a re-run has written: what it kept, with every row it
 * wrote in place of the one it replaced. first_reading's figures are the
 * day's, not only the re-read's.
 */
export function dayRows<A extends { question_id: string; engine: string }, S extends { keyword_id: string }>(
  kept: Kept,
  answers: A[],
  serp: S[],
): { answers: (A | KeptAnswer)[]; serp: (S | KeptSerp)[] } {
  const a = new Map<string, A | KeptAnswer>(kept.answers.map((k) => [jobKey(k.question_id, k.engine), k]));
  for (const r of answers) a.set(jobKey(r.question_id, r.engine), r);
  const s = new Map<string, S | KeptSerp>(kept.serp.map((k) => [k.keyword_id, k]));
  for (const r of serp) s.set(r.keyword_id, r);
  return { answers: [...a.values()], serp: [...s.values()] };
}
