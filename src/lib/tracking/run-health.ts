import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { liveOn, shouldTrack, trackingDay } from "./decide.ts";
import { runIsStalled, runIsStuck } from "./dispatch.ts";

/**
 * Run health - whether each client that should have been read today was
 * (9 Oct 2026, audit reliability-6 and spec OP-1).
 *
 * Every tracking failure ended in console.warn. A failed, partial, stalled or
 * missing run reached nobody, and a missed alwaystracked day cannot be read
 * again later, so a gap nobody hears about by the morning is a gap for good.
 * This is one reading of a day's runs against who should have run, used by
 * four things that must not disagree:
 *
 * - reportRunHealth: one summary to our own inbox (health-mail.ts) once the
 *   day has settled with any client not complete - sent by whichever run
 *   closes last, or by the daily cron when nothing was dispatched, claimed
 *   once per day in dashboard_events;
 * - /api/health/runs: a JSON for an uptime monitor, 503 once the deadline has
 *   passed with any client not complete or partial (healthAnswer);
 * - the fleet strip on /admin/tracking;
 * - the daily dispatch itself, through readTrackable, so "who should have
 *   run" is the dispatcher's own rule and not a second copy of it.
 *
 * Loadable by node --test: relative imports, no server-only, the database and
 * the sender passed in (run-health.test.mts runs it against an in-memory one).
 */

/** Where a client's day stands. */
export type RunState =
  | "complete"
  | "partial"
  | "failed"
  /** Opened and not claimed yet - in flight. */
  | "queued"
  /** Claimed and reading - in flight. */
  | "running"
  /** Queued past TRACKING_STUCK_MS with no dispatch error: never claimed. */
  | "stuck"
  /** Running past TRACKING_STALL_MS: killed by the platform. */
  | "stalled"
  /** Queued with a dispatch error on it: nothing will pick it up without "Run now". */
  | "undispatched"
  /** Should have run and has no row. */
  | "missing";

export const RUN_STATES: readonly RunState[] = ["complete", "partial", "failed", "queued", "running", "stuck", "stalled", "undispatched", "missing"];

/** The states still in flight. Anything else is where the day ends unless somebody acts. */
const IN_FLIGHT = new Set<RunState>(["queued", "running"]);

/** What a client's day counts as for the monitor: read, even if some reads failed. */
const READ = new Set<RunState>(["complete", "partial"]);

export type HealthRun = {
  client_domain_id: string;
  status: string;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at?: string | null;
  dfs_cost?: number | string | null;
};

export type TrackableClient = {
  id: string;
  domain: string;
  status: string | null;
  started_on: string | null;
  tier: string | null;
  activeQuestions: number;
  /** decide.ts shouldTrack on the day: whether the daily dispatch opens a run for it. */
  track: boolean;
};

export type ClientHealth = { id: string; domain: string; state: RunState; error: string | null };

export type RunHealth = {
  day: string;
  /** Clients that should have a run on the day (shouldTrack). */
  expected: number;
  /** Every expected client, and any other client with a run on the day. */
  clients: ClientHealth[];
  counts: Record<RunState, number>;
  /** Nothing is in flight: the day ends as it stands unless somebody acts. */
  settled: boolean;
  /** Every client listed was read, complete or partial. */
  ok: boolean;
};

/** One run's state at `now`. A status this file does not know reads as failed rather than as fine. */
export function runState(run: HealthRun | undefined, now: number): RunState {
  if (!run) return "missing";
  switch (run.status) {
    case "complete":
    case "partial":
    case "failed":
      return run.status;
    case "queued":
      if (run.error) return "undispatched";
      return runIsStuck(run, now) ? "stuck" : "queued";
    case "running":
      return runIsStalled(run, now) ? "stalled" : "running";
    default:
      return "failed";
  }
}

/** Problems first, worst first, then by domain - the order the summary and the strip list them in. */
const ORDER: Record<RunState, number> = { missing: 0, undispatched: 1, stuck: 2, stalled: 3, failed: 4, partial: 5, running: 6, queued: 7, complete: 8 };

export function runHealth(p: { day: string; now: number; clients: readonly TrackableClient[]; runs: readonly HealthRun[] }): RunHealth {
  const byClient = new Map(p.runs.map((r) => [r.client_domain_id, r]));
  const domains = new Map(p.clients.map((c) => [c.id, c.domain]));
  const expected = p.clients.filter((c) => c.track);
  const ids = [...new Set([...expected.map((c) => c.id), ...p.runs.map((r) => r.client_domain_id)])];
  const clients = ids
    .map((id) => {
      const run = byClient.get(id);
      return { id, domain: domains.get(id) ?? id, state: runState(run, p.now), error: run?.error ?? null };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.domain.localeCompare(b.domain));
  const counts = Object.fromEntries(RUN_STATES.map((s) => [s, 0])) as Record<RunState, number>;
  for (const c of clients) counts[c.state] += 1;
  return {
    day: p.day,
    expected: expected.length,
    clients,
    counts,
    settled: clients.every((c) => !IN_FLIGHT.has(c.state)),
    ok: clients.every((c) => READ.has(c.state)),
  };
}

/**
 * By when a day's runs should all be read: 07:00 UTC on the day. The cron
 * fires at 05:00 UTC, which is the same London day in summer and winter, and
 * a run takes under five minutes, so two hours is room for a re-run (OP-1:
 * "Danny knows by 07:00 UTC").
 */
export const HEALTH_DEADLINE_UTC = "07:00";

export function healthDeadline(day: string): number {
  return Date.parse(`${day}T${HEALTH_DEADLINE_UTC}:00Z`);
}

/**
 * What /api/health/runs answers: 503 once the deadline has passed with any
 * client not read, so a monitor that knows only status codes alerts on it;
 * 200 otherwise, before the deadline whatever the state. A partial run is
 * read - it is in the summary mail, not a page. No domain, id, cost or count
 * of clients: only how many are unread and in which state, which says
 * nothing about who the clients are or how many there are.
 */
export function healthAnswer(h: RunHealth, now: number): { status: 200 | 503; body: Record<string, unknown> } {
  const deadline = healthDeadline(h.day);
  const late = !h.ok && now >= deadline;
  const unread = Object.fromEntries(RUN_STATES.filter((s) => !READ.has(s) && h.counts[s] > 0).map((s) => [s, h.counts[s]]));
  return {
    status: late ? 503 : 200,
    body: {
      day: h.day,
      checked_at: new Date(now).toISOString(),
      deadline: new Date(deadline).toISOString(),
      ok: h.ok,
      late,
      unread,
    },
  };
}

/** How a state reads in the summary and on the strip. */
export const STATE_WORDS: Record<RunState, string> = {
  complete: "complete",
  partial: "partial",
  failed: "failed",
  queued: "queued",
  running: "running",
  stuck: "never claimed",
  stalled: "stalled (running past 15 minutes)",
  undispatched: "not dispatched",
  missing: "no run",
};

/**
 * The summary: one line per client not complete, its state and its run's
 * error line, and where to act. Plain text, to our own inbox only.
 */
export function healthMail(h: RunHealth, p: { today: string; adminUrl: string; note?: string | null }): { subject: string; text: string } {
  const looking = h.clients.filter((c) => c.state !== "complete");
  const total = h.clients.length;
  const tally = RUN_STATES.filter((s) => h.counts[s] > 0)
    .map((s) => `${STATE_WORDS[s]} ${h.counts[s]}`)
    .join(", ");
  const act =
    h.day === p.today
      ? `Run now on /admin/tracking reads a failed, partial or stalled run's missing reads again, today only: ${p.adminUrl}`
      : `This is ${h.day}'s summary, sent the morning after because the day never settled or the mail did not go. That day can no longer be re-run: ${p.adminUrl}`;
  return {
    subject: `alwaystracked run health ${h.day}: ${looking.length} of ${total} client${total === 1 ? "" : "s"} to look at`,
    text: [
      `The daily check for ${h.day} (London) has ${looking.length} of ${total} client${total === 1 ? "" : "s"} not complete.`,
      tally,
      ...(p.note ? ["", p.note] : []),
      "",
      ...looking.map((c) => `- ${c.domain}: ${STATE_WORDS[c.state]}${c.error ? ` - ${c.error}` : ""}`),
      "",
      act,
    ].join("\n"),
  };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Every active client and whether the daily dispatch reads it on `day` -
 * decide.ts shouldTrack over its live prompts. The dispatch and every health
 * reading call this, so they cannot disagree about who should have run.
 *
 * Paged (9 Oct 2026, audit reliability-2). The dispatch read every unstopped
 * prompt across every client in one select, and PostgREST answers a select
 * with at most db-max-rows rows - 1000 by default - and says so nowhere. Past
 * a thousand live prompts (about twenty full alwaystracked clients) the rows
 * beyond it were dropped, those clients counted no live prompt, were skipped
 * and got no run, and nothing errored. Ended clients' prompts are never
 * stopped, so they use up the thousand too.
 */
export async function readTrackable(db: SupabaseClient, day: string): Promise<TrackableClient[]> {
  let clients: Record<string, unknown>[];
  let prompts: { client_domain_id: string; added_on: string; stopped_on: string | null }[];
  try {
    clients = await selectAll<Record<string, unknown>>((from, to) =>
      db.from("client_domains").select("id, domain, status, started_on, tier").eq("status", "active").order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the tracked clients: ${msg(err)}`);
  }
  try {
    prompts = await selectAll<{ client_domain_id: string; added_on: string; stopped_on: string | null }>((from, to) =>
      db.from("tracked_questions").select("client_domain_id, added_on, stopped_on").is("stopped_on", null).order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the tracked questions: ${msg(err)}`);
  }
  const live = new Map<string, number>();
  for (const q of prompts) {
    if (!liveOn(q, day)) continue;
    live.set(q.client_domain_id, (live.get(q.client_domain_id) ?? 0) + 1);
  }
  return clients.map((c) => {
    const client = {
      id: c.id as string,
      status: c.status as string | null,
      started_on: c.started_on as string | null,
      activeQuestions: live.get(c.id as string) ?? 0,
    };
    return { ...client, domain: c.domain as string, tier: c.tier as string | null, track: shouldTrack(client, day) };
  });
}

/** Every run on `day`, every page. */
export async function readDayRuns(db: SupabaseClient, day: string): Promise<HealthRun[]> {
  try {
    return await selectAll<HealthRun>((from, to) =>
      db
        .from("tracking_runs")
        .select("client_domain_id, status, error, created_at, started_at, finished_at, dfs_cost")
        .eq("run_date", day)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    throw new Error(`could not read the day's runs: ${msg(err)}`);
  }
}

/** A day's health as the monitor, the strip and the summary read it. */
export async function readRunHealth(db: SupabaseClient, day: string, now: number): Promise<RunHealth> {
  const [runs, clients] = await Promise.all([readDayRuns(db, day), readTrackable(db, day)]);
  return runHealth({ day, now, clients, runs });
}

/** The dashboard_events row that claims a day's summary, keyed on props.day; unique per day with 20261009000000. */
export const RUN_HEALTH_EVENT = "run_health_mail";

/** A claim whose mail reached nobody, renamed so the next reading of the day may send it. */
export const RUN_HEALTH_UNSENT = "run_health_unsent";

export type HealthIo = {
  send: (mail: { subject: string; text: string }) => Promise<boolean>;
  adminUrl: string;
};

export type ReportOutcome = "sent" | "unsent" | "taken" | "healthy" | "pending";

/**
 * Send the day's summary if the day has settled with any client not
 * complete, and nobody has sent it. Called by every run as it closes - all
 * but the last return at the first read, a sibling still in flight - and by
 * the daily cron after it dispatches, which sends at once when nothing was
 * dispatched (the switch, the cap, a failed read of the clients) and, for the
 * day before, sends what was never sent: a day with a run the platform killed
 * never settles while it is running, and the stall sweep has closed it by the
 * next morning.
 *
 * Claimed before the send, as lifecycle-sweep.ts claims its emails: a
 * run_health_mail row in dashboard_events with props.day, read first, and
 * made exact by 20261009000000's unique index (two runs closing together both
 * reading no claim). Without the index two such runs can both send. A send
 * that reaches nobody renames its claim, so the next reading may try again.
 *
 * `note` is what the dispatcher knows and the rows cannot say: why nothing
 * was dispatched.
 */
export async function reportRunHealth(db: SupabaseClient, io: HealthIo, p: { day: string; now: number; note?: string | null }): Promise<ReportOutcome> {
  const runs = await readDayRuns(db, p.day);
  if (runs.some((r) => IN_FLIGHT.has(runState(r, p.now)))) return "pending";
  const h = runHealth({ day: p.day, now: p.now, clients: await readTrackable(db, p.day), runs });
  if (!h.settled) return "pending";
  if (h.clients.every((c) => c.state === "complete")) return "healthy";

  const { data: sent, error: sErr } = await db.from("dashboard_events").select("id").eq("event", RUN_HEALTH_EVENT).eq("props->>day", p.day).limit(1);
  if (sErr) throw new Error(`could not read the run-health claim: ${sErr.message}`);
  if ((sent ?? []).length) return "taken";
  const { data: claim, error: cErr } = await db
    .from("dashboard_events")
    .insert({ client_domain_id: null, member_email: null, event: RUN_HEALTH_EVENT, path: null, props: { day: p.day } })
    .select("id")
    .single();
  if (cErr) {
    if (cErr.code === "23505") return "taken";
    throw new Error(`could not claim the run-health mail: ${cErr.message}`);
  }
  if (await io.send(healthMail(h, { today: trackingDay(new Date(p.now)), adminUrl: io.adminUrl, note: p.note }))) return "sent";
  const { error: uErr } = await db.from("dashboard_events").update({ event: RUN_HEALTH_UNSENT }).eq("id", claim.id as number);
  if (uErr) console.warn(`[track] run-health mail for ${p.day} not sent, and its claim not released: ${uErr.message}`);
  return "unsent";
}
