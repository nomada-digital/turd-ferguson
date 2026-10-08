"use client";

import { usePathname } from "next/navigation";

/**
 * The marketing header and footer, everywhere but the client dashboard.
 *
 * /app is a full-height shell of its own - sidebar left, content right - as
 * boards/Main.dc.html draws it, with neither the site nav nor the site footer
 * (R104, Reviewer, 29 Sep 2026). A route group would mean moving every public
 * page's folder, and several censuses record those paths; the pathname is read
 * on the server render too, so the chrome is absent with JS off as well.
 */
export function isAppPath(pathname: string | null): boolean {
  return pathname === "/app" || (pathname ?? "").startsWith("/app/");
}

/**
 * On the dashboard's own host (APP_HOST, 8 Oct 2026) the browser path carries
 * no /app, so the check above cannot see it, and reading the Host header in
 * the root layout would make every static page dynamic. Instead the chrome is
 * wrapped, and the /app layout's `data-app-tree` marker hides it through one
 * `:has()` rule in globals.css - server drawn, so it holds with JS off.
 * `display: contents`, in the stylesheet rather than inline so the hiding
 * rule can outrank it, keeps the wrapper out of the layout.
 */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  return isAppPath(usePathname()) ? null : (
    <div className="site-chrome">
      {children}
    </div>
  );
}
