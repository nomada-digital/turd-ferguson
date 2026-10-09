import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { liveOn, shouldTrack } from "./decide.ts";

/**
 * Who should be read on a day (9 Oct 2026, audit reliability-2): every
 * active client, with decide.ts shouldTrack's verdict over its live prompts.
 * The daily dispatch opens a run for each client it says yes to. Read in
 * pages, because the read it replaces took every client's prompts in one.
 *
 * Loadable by node --test: relative imports, no server-only, the database
 * passed in (run-health.test.mts runs it against an in-memory one).
 */

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
