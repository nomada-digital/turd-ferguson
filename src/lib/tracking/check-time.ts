/**
 * When the daily check runs, said in the client's own zone (9 Oct 2026,
 * audit copy-2, data-9, ia-9, activation-13).
 *
 * The track cron is `0 5 * * *` UTC (vercel.json). That is 06:00 in London
 * only while British Summer Time lasts; from 25 Oct 2026 it is 05:00, and for
 * a US client it is 1am or midnight in New York. The dashboard, Settings,
 * Reports, setup and the lifecycle mail wrote "06:00" with no zone in about
 * thirty places, so every one of them was an hour wrong each winter and a
 * London time to a US client all year. Each now asks this module for the
 * time on the day it means, in the zone of the client's market, labelled the
 * way trialMoment labels the trial's end: "06:00 UK time", "1:00am ET".
 *
 * Pure and imports nothing, so `node --test` loads it and the trial's
 * client-side wording (config/trial.ts) pulls in nothing more.
 * check-time.test.mts holds the census that keeps a clock time out of copy
 * and ties CHECK_HOUR_UTC to vercel.json.
 */

/** The daily check's hour in UTC: vercel.json schedules /api/cron/track at `0 5 * * *`. */
export const CHECK_HOUR_UTC = 5;

/** The zone a market's client reads times in: London for UK, New York for everyone else, as trialMoment. */
export function marketZone(market: string): "Europe/London" | "America/New_York" {
  return market.toLowerCase() === "uk" ? "Europe/London" : "America/New_York";
}

/**
 * A moment's time of day as the client's market reads it: "06:10 UK time" for
 * a UK client, "1:10am ET" for a US one. Null for a timestamp that does not parse.
 */
export function clockIn(at: string | number | Date, market: string): string | null {
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  const zone = marketZone(market);
  const uk = zone === "Europe/London";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: !uk }).formatToParts(t).map((p) => [p.type, p.value]),
  );
  if (uk) return `${String(parts.hour).padStart(2, "0")}:${parts.minute} UK time`;
  return `${Number(parts.hour)}:${parts.minute}${String(parts.dayPeriod ?? "").toLowerCase().replace(/\s|\./g, "")} ET`;
}

/**
 * The daily check's time on `day` - a tracking day, YYYY-MM-DD, as the
 * dashboard dates a run - in the client's zone. UK: "06:00 UK time" in
 * summer, "05:00 UK time" in winter. US: "1:00am ET", "12:00am ET" once New
 * York's clocks go back. The 05:00 UTC run always falls on that same date in
 * both zones, so "tomorrow at" stays true of the day the dashboard means.
 */
export function checkTime(day: string, market: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return clockIn(Date.UTC(y!, m! - 1, d!, CHECK_HOUR_UTC), market) ?? `${String(CHECK_HOUR_UTC).padStart(2, "0")}:00 UTC`;
}

/**
 * What is said in place of a check time while a client has no live prompt:
 * the runner skips that client (decide.ts shouldTrack), so no time is
 * promised. The Overview's day-zero line, the setup page and setup_confirmed
 * share it (9 Oct 2026, review of 3eaa592).
 */
export const NO_PROMPT_NO_CHECK = "Nothing is checked until a cluster has prompts.";

/** The next daily run after `now`, epoch ms: today's 05:00 UTC if it is still to come, else tomorrow's. */
export function nextCheckAt(now: number): number {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CHECK_HOUR_UTC);
  return at > now ? at : at + 86_400_000;
}
