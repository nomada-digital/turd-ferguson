/**
 * "1 October 2026" from an ISO date. Pure, so the shared charts
 * (src/components/charts) can print dates on the dashboard without importing
 * the case-study feed; lib/case-studies.ts re-exports it.
 */
export function longDate(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
