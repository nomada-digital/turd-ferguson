/**
 * Where sign-in lands while a client's setup is unconfirmed (R166 part 3a,
 * Danny, danny.md line 175: "After auth, redirect to /setup until
 * confirmed"). /api/app/auth asks it since part 3c.
 *
 * Setup is confirmed once the client has a dashboard_events row named
 * SETUP_CONFIRMED_EVENT. The column has no database whitelist, so the event
 * needs no migration.
 *
 * Until then setup wins over a safe next: "until confirmed" is Danny's word,
 * and a bookmark into a dashboard with nothing set up lands on empty panels.
 * A next that is already that client's setup page is kept as it is.
 */
export const SETUP_CONFIRMED_EVENT = "setup_confirmed";

import { appPath } from "../app-host.ts";

export const setupPath = (slug: string) => appPath(`/${slug}/setup`);

export function setupConfirmed(events: readonly { event: string }[]): boolean {
  return events.some((e) => e.event === SETUP_CONFIRMED_EVENT);
}

/**
 * R166 part 3c: the first started_on that goes through setup. The page went
 * live on 1 Oct 2026 at 19:16Z, and signup starts a client the day after
 * purchase (signup.ts), so every client bought from then on starts on
 * 2 Oct or later. Clients started before were set up by hand, have no
 * setup_confirmed row, and would otherwise be sent through a setup they
 * have already had. A missing start is one of those.
 */
export const SETUP_SINCE = "2026-10-02";

export function needsSetup(c: { started_on: string | null }): boolean {
  return c.started_on !== null && c.started_on >= SETUP_SINCE;
}

/**
 * DS10 (R172 pass 1 part 3, 2 Oct 2026): whether the Overview says setup is
 * still to confirm. Sign-in lands on setup, but a member who leaves it and
 * comes back through /app or a bookmark reached the Overview with no way
 * back. A failed read (null) says nothing. The fixture's dates are frozen
 * before SETUP_SINCE, so there its own confirmed flag is the whole answer.
 */
export function setupOutstanding(c: { started_on: string | null }, confirmed: boolean | null, fixture = false): boolean {
  return confirmed === false && (fixture || needsSetup(c));
}

export function landingAfterAuth(o: {
  next: string | null;
  /** The member's clients in the order /app lists them; null when the read failed. */
  clients: readonly { slug: string; confirmed: boolean }[] | null;
}): string {
  if (o.clients === null) return o.next ?? appPath("");
  if (!o.clients.length) return appPath("/login?access=none");
  const first = o.clients[0]!;
  if (!first.confirmed) return setupPath(first.slug);
  return o.next ?? appPath(`/${first.slug}`);
}

/** The prompts a setup card shows: the scan's five angles, one each (signup.ts PROMPTS_PER_CLUSTER). */
export const SETUP_PROMPTS = 5;

export type SetupCard = { id: string; name: string; keyword: string | null; prompts: { id: string; text: string; angle: string | null }[] };

/**
 * Step 2 of /app/[client]/setup (R166 part 3b): one card per live cluster
 * bought, in the order the dashboard lists them, with its keyword (null is
 * "Needs a keyword") and up to SETUP_PROMPTS of its live prompts.
 */
export function setupCards(d: {
  clusters: readonly { id: string; name: string; keyword_id: string | null; stopped_on: string | null }[];
  questions: readonly { id: string; text: string; cluster_id: string | null; stopped_on: string | null; angle: string | null }[];
  keywords: readonly { id: string; keyword: string }[];
}): SetupCard[] {
  return d.clusters
    .filter((c) => c.stopped_on === null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      keyword: d.keywords.find((k) => k.id === c.keyword_id)?.keyword ?? null,
      prompts: d.questions
        .filter((q) => q.cluster_id === c.id && q.stopped_on === null)
        .slice(0, SETUP_PROMPTS)
        .map((q) => ({ id: q.id, text: q.text, angle: q.angle })),
    }));
}

/** Step 3's button: Danny's words on the placement tiers, a tracking plan's plainer ones. */
export const confirmLabel = (placed: boolean) => (placed ? "Confirm - these are what you'll target" : "Confirm - start tracking these");

/**
 * R166 step 6: a client's setup state as /admin/tracking shows it. Confirmed
 * names the day and who pressed Confirm, from the earliest setup_confirmed
 * row; a client started before SETUP_SINCE was set up by hand and never
 * passes through the page; anyone else is still waiting on the client.
 */
export function setupState(c: { started_on: string | null }, rows: readonly { created_at: string; member_email: string | null }[]): string {
  const first = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (first) return `setup confirmed ${first.created_at.slice(0, 10)}${first.member_email ? ` by ${first.member_email}` : ""}`;
  return needsSetup(c) ? "setup not confirmed yet" : "set up by hand (before the setup page)";
}
