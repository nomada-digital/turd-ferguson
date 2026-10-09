"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { PROP_KEYS, dashPath, isUsageEvent, usageSlug } from "@/lib/tracking/usage";

/**
 * Sends the dashboard's usage events (BRIEF-2 T10, R98, 30 Sep 2026) to
 * POST /api/app/[client]/event. Renders nothing; with JS off nothing is sent
 * and nothing on the page depends on it.
 *
 * - `view` on every route the member opens.
 * - A click on anything carrying `data-usage="<event>"`, with its
 *   `data-usage-<key>` ids as props (preset, engine, cta, type, on).
 * - A `<details data-usage-open="add_open" data-usage-close="add_abandon">`
 *   sends the first when opened and the second when closed again unsaved.
 * - `cta_shown` for each upgrade prompt on the page (`data-usage-shown`).
 *
 * The server keeps only the event, the route's shape and those ids.
 */
function send(slug: string, event: string, props: Record<string, string> = {}) {
  if (!isUsageEvent(event)) return;
  const body = JSON.stringify({ event, path: dashPath(window.location.pathname), props });
  fetch(`/api/app/${encodeURIComponent(slug)}/event`, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
}

function propsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PROP_KEYS) {
    const v = el.getAttribute(`data-usage-${k}`);
    if (v) out[k] = v;
  }
  return out;
}

export function UsageBeacon() {
  const pathname = usePathname();
  // dashPath: on the app host the path has no /app prefix (M1), and the slug and route are read from the /app form.
  const slug = pathname ? usageSlug(dashPath(pathname)) : null;

  useEffect(() => {
    if (!slug) return;
    send(slug, "view");
    for (const el of document.querySelectorAll("[data-usage-shown]")) send(slug, "cta_shown", { cta: el.getAttribute("data-usage-shown") ?? "" });
  }, [slug, pathname]);

  useEffect(() => {
    if (!slug) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-usage]");
      if (el) send(slug, el.getAttribute("data-usage") ?? "", propsOf(el));
    };
    const onToggle = (e: Event) => {
      const el = e.target as HTMLDetailsElement;
      if (!(el instanceof HTMLDetailsElement)) return;
      const event = el.getAttribute(el.open ? "data-usage-open" : "data-usage-close");
      if (event) send(slug, event, propsOf(el));
    };
    document.addEventListener("click", onClick);
    document.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, [slug]);

  return null;
}
