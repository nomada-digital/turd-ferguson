/**
 * R151 (3 Oct 2026): the walkthrough ask posted without script comes back by a
 * 303 carrying only its outcome - never the address - as `?walkthrough=`. The
 * page reads it here and hands it to WalkthroughForm, which says it in place.
 */
export type WalkthroughOutcome = "video" | "demo" | "bad" | "personal" | "failed";

export function readWalkthroughOutcome(raw: string | string[] | undefined): WalkthroughOutcome | null {
  return raw === "video" || raw === "demo" || raw === "bad" || raw === "personal" || raw === "failed" ? raw : null;
}

/** Where a form post goes back to: the scan result or the reading it came from, else the scan. */
export function walkthroughBack(raw: unknown, token: string): string {
  return typeof raw === "string" && /^\/(scan|coverage-check)\/[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : `/scan/${token}`;
}
