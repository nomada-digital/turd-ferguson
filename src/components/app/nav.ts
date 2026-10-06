/**
 * Where each dashboard nav item goes (R130, Danny, 30 Sep 2026, danny.md 119).
 * A string is the route under /app/[client] ("" is the overview); SOON is an
 * item whose page is not built, drawn disabled with "Coming soon". Every item
 * the sidebar or the phone tabs draw has an entry here, and nav.test.mts
 * (R131) holds each string to a real route and each built route to an item.
 *
 * Plain module, relative imports only, so node --test can load it.
 */

import { appPath } from "../../lib/app-host.ts";

export const SOON = null;

export const NAV = ["Overview", "Clusters", "Who is named", "Cited pages", "Reports", "Settings"] as const;
// R141 (1 Oct 2026; BRIEF-4 P1): the flat client's Google keywords / Keywords
// item is gone. Every client is grouped or has the Overview's ungrouped state
// (R138), and the keyword lives on its cluster card, so both layouts draw the
// same tabs.
export const TABS = ["Overview", "Clusters", "Reports", "Settings"] as const;
// R121 (30 Sep 2026): on a client with cluster rows the Google keyword lives on
// its cluster card, so there is no keywords tab - boards-3/Main.dc.html's nav
// and boards-3/Mobile.dc.html's four tabs. A flat client keeps the T3 lists.
// R97 part 3 (30 Sep 2026; BRIEF-2 T13): Placements sits after Clusters, as
// boards-3/Placements.dc.html's nav draws it, and only on a client with a
// placed cluster - the Sidebar drops it otherwise (PLACEMENTS_ITEM).
export const PLACEMENTS_ITEM = "Placements";
export const CLUSTER_NAV = ["Overview", "Clusters", PLACEMENTS_ITEM, ...NAV.filter((n) => n !== "Overview" && n !== "Clusters")] as const;
export const CLUSTER_TABS = ["Overview", "Clusters", "Reports", "Settings"] as const;

export const NAV_TARGET: Record<string, string | typeof SOON | undefined> = {
  Overview: "",
  Clusters: "/clusters",
  Placements: "/placements",
  // R143 (1 Oct 2026; BRIEF-4 P3).
  "Who is named": "/named",
  // R144 (1 Oct 2026; BRIEF-4 P4).
  "Cited pages": "/cited",
  // R145 (1 Oct 2026; BRIEF-4 P5).
  Reports: "/reports",
  Settings: "/settings",
};

/** The href for an item on this client, or null when it is not built. */
export function navHref(item: string, slug: string): string | null {
  const t = NAV_TARGET[item];
  return typeof t === "string" ? appPath(`/${slug}${t}`) : null;
}

/**
 * R132 (Danny, 30 Sep 2026, danny.md 121): the Overview cards whose full page
 * is a nav item. Each links there once the page is built and until then shows
 * "Coming soon" unlinked, as the sidebar does; nav.test.mts holds the pairing.
 */
export const SEE_ALL = { "Who is named instead": "Who is named", "Pages the engines cite most": "Cited pages" } as const;

/** The same, from a path already under the client (`/app/<slug>`). */
export function navFrom(item: string, clientPath: string): string | null {
  const t = NAV_TARGET[item];
  return typeof t === "string" ? `${clientPath}${t}` : null;
}
