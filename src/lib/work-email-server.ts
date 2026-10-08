import "server-only";

import { getSettings } from "@/lib/scan/settings";

/**
 * `app_settings.work_email_blocked_extra`, for a handler to pass to
 * `isWorkEmail`. Fail-safe like the other settings reads: if the read fails
 * the built-in list still applies, logged, and the visitor is not refused for
 * our outage.
 */
export async function workEmailBlockedExtra(): Promise<string[]> {
  try {
    return (await getSettings()).work_email_blocked_extra;
  } catch (e) {
    console.warn("[work-email] could not read the extra blocked domains: " + (e instanceof Error ? e.message : String(e)));
    return [];
  }
}
