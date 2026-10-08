"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * One row of filter chips on Who is named and Cited pages (8 Oct 2026, audit
 * mobile-4). Below 560px each row is a single line that scrolls sideways
 * (globals.css, .app-nm-filters), so /named?cluster=c8 loaded with its chip
 * 1,479px to the right of a 358px row, and the page gave no sign it was
 * filtered. On load, and whenever the pick changes, a current chip that is not
 * wholly in view is scrolled to the middle of its row. With JS off the
 * headline still names the filter (Named.tsx, Cited.tsx).
 *
 * `current` is the picked value, so the effect runs again when it changes on a
 * soft navigation, where the row itself is kept.
 */
export default function ChipRow({ label, current, children }: { label: string; current: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    const on = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth + 1) return;
    const n = nav.getBoundingClientRect();
    const c = on.getBoundingClientRect();
    if (c.left >= n.left && c.right <= n.right) return;
    nav.scrollLeft += c.left + c.width / 2 - (n.left + n.width / 2);
  }, [current]);

  return (
    <nav ref={ref} aria-label={label} className="app-nm-filters" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {children}
    </nav>
  );
}
