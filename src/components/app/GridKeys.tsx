"use client";

import { useEffect } from "react";

/**
 * DB-2 (9 Oct 2026): the one-cluster day grid and the Overview's heat map are
 * grids of links - 4 engines by 28 days, 10 clusters by 28 - so as links alone
 * they put up to 280 tab stops between a keyboard and the rest of the page.
 * With script they are one stop each, as a grid is: Tab enters on the open day
 * (the picked square) or the latest, the arrow keys move between days and
 * rows, Home and End go to a row's first and last day, Enter opens. Without
 * script every link stays a tab stop, so nothing is out of reach either way.
 *
 * Each link carries `data-row` and `data-col`; a day with nothing to open is
 * no link, so a move goes on to the nearest day that has one. `version` is
 * what the grid shows (the prompt, the day, the range), so a new grid after a
 * navigation is set up again.
 */
export default function GridKeys({ target, version }: { target: string; version: string }) {
  useEffect(() => {
    const root = document.getElementById(target);
    if (!root) return;
    const cells = [...root.querySelectorAll<HTMLElement | SVGElement>("[data-row][data-col]")];
    if (!cells.length) return;
    const pos = (el: HTMLElement | SVGElement) => [Number(el.dataset.row), Number(el.dataset.col)] as const;
    const rows = [...new Set(cells.map((el) => pos(el)[0]))].sort((a, b) => a - b);
    const inRow = (r: number) => cells.filter((el) => pos(el)[0] === r).sort((a, b) => pos(a)[1] - pos(b)[1]);
    const closest = (list: (HTMLElement | SVGElement)[], col: number) => list.reduce<HTMLElement | SVGElement | null>((best, el) => (best === null || Math.abs(pos(el)[1] - col) < Math.abs(pos(best)[1] - col) ? el : best), null);
    const start = cells.find((el) => el.getAttribute("aria-current") === "true") ?? inRow(rows[0]!).at(-1)!;
    for (const el of cells) el.setAttribute("tabindex", el === start ? "0" : "-1");

    const onKey = (e: KeyboardEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement | SVGElement>("[data-row][data-col]");
      if (!el || !root.contains(el) || e.altKey || e.ctrlKey || e.metaKey) return;
      const [r, c] = pos(el);
      const row = inRow(r);
      const ri = rows.indexOf(r);
      let next: HTMLElement | SVGElement | null | undefined = null;
      if (e.key === "ArrowLeft") next = row.filter((x) => pos(x)[1] < c).at(-1);
      else if (e.key === "ArrowRight") next = row.find((x) => pos(x)[1] > c);
      else if (e.key === "Home") next = row[0];
      else if (e.key === "End") next = row.at(-1);
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const step = e.key === "ArrowUp" ? -1 : 1;
        for (let i = ri + step; i >= 0 && i < rows.length && !next; i += step) next = closest(inRow(rows[i]!), c);
      } else return;
      e.preventDefault();
      if (!next || next === el) return;
      el.setAttribute("tabindex", "-1");
      next.setAttribute("tabindex", "0");
      next.focus();
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [target, version]);
  return null;
}
