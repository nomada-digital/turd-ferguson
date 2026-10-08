"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The phone shell's menus close as menus do (8 Oct 2026, audit mobile-10).
 * More and the client switcher are <details>, so they open with JS off; but a
 * <details> only closes from its own summary, so with More open a tap outside
 * and Escape both left it standing over the page. With JS, a pointer down
 * outside an open one, Escape (focus goes back to its summary) and a move to
 * another page each close it.
 *
 * `selector` names the <details> elements this owns.
 */
export default function MenuCloser({ selector }: { selector: string }) {
  const path = usePathname();

  useEffect(() => {
    const open = () => [...document.querySelectorAll<HTMLDetailsElement>(selector)].filter((d) => d.open);
    const onDown = (e: PointerEvent) => {
      for (const d of open()) if (!(e.target instanceof Node && d.contains(e.target))) d.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      for (const d of open()) {
        const inside = d.contains(document.activeElement);
        d.open = false;
        if (inside) d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [selector]);

  useEffect(() => {
    for (const d of document.querySelectorAll<HTMLDetailsElement>(selector)) d.open = false;
  }, [path, selector]);

  return null;
}
