import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";

/**
 * The two ways back to an unfiltered list on Clusters, Who is named and Cited
 * pages (8 Oct 2026, audits mobile-4 and mobile-6). Both are links, so they
 * work with JS off, and both keep the date range: the caller builds the href
 * from the page's own `base` query.
 */

/** The x inside a search box once a search is in the URL. The box's GET form only submitted from the keyboard's return key. */
export function ClearSearch({ href }: { href: string }) {
  return (
    <Link href={href} aria-label="Clear the search" title="Clear the search" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: "28px", height: "28px", margin: "0 -6px 0 0", borderRadius: "8px", color: T.soft }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </Link>
  );
}

/** Beside a list's headline when any filter or search is on: every filter off, the range kept. */
export function ClearFilters({ href }: { href: string }) {
  return (
    <Link href={href} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
      Clear filters
    </Link>
  );
}
