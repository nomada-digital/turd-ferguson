/**
 * The 3-step strip: what happens after a plan is bought (Danny, danny.md
 * lines 161 and 175). One copy, read by the welcome email and by the strip on
 * the tier pages, /packages and /checkout, so the promise made before payment
 * is the one the email repeats after it. No placement timelines here or
 * anywhere this is drawn (R166).
 *
 * ON-1 (9 Oct 2026, launch blocker LB8): setup is self-serve. A buyer checks
 * a keyword on the setup page and edits the five prompts drafted from it, so
 * nothing waits on a person, and the strip says so. The first readings come
 * from the daily check after a cluster's prompts are in - the runner skips a
 * client with no live prompt (decide.ts shouldTrack) - not "the next morning".
 *
 * `at` is the daily check's time where the client's market is known - the
 * setup page and the welcome email, worded by check-time.ts (checkTime, so
 * "06:00 UK time" or "1:00am ET"). The public pages know no market and pass
 * nothing, so they state no time.
 */
export function nextSteps(at: string | null = null): readonly [string, string, string] {
  return [
    "Set up your clusters: check a Google keyword for each, then edit the five prompts drafted from it.",
    at ? `Your first readings come from the daily check at ${at} after your prompts are in.` : "Your first readings come from the daily check after your prompts are in.",
    "Your dashboard shows where you are named, and where you rank.",
  ];
}

/** The strip as the public pages draw it: no market, so no time. */
export const NEXT_STEPS = nextSteps();

export const NEXT_STEPS_HEADING = "What happens after you buy";
