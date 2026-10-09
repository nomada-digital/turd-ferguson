"use client";

import { useEffect } from "react";

/**
 * DB-2 (9 Oct 2026): a link to one day's answer (a day-grid square, a Who is
 * named or Cited pages prompt, an Overview heat cell) ends on the answer
 * panel's anchor. Next scrolls there, but this version's scroll handler leaves
 * focus where it was (appNewScrollHandler, on by default: "resetting focus on
 * navigation is deferred"), so a keyboard or screen-reader user stayed on the
 * square while the page moved to the answer. When the address names the
 * panel, focus goes to it, without a second scroll: the panel is a labelled
 * region ("Answers on 15 Sep 2026") with tabIndex -1, and .app-answer:focus
 * draws no ring round the card. `at` is the day and engine shown, so each new
 * answer opened takes focus once, and a tab change, whose link has no anchor,
 * leaves it alone. With `?day=` the grid's picked square is scrolled into
 * sight too (below).
 */
export default function AnswerFocus({ id, at }: { id: string; at: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    document.getElementById(id)?.focus({ preventScroll: true });
  }, [id, at]);
  // The day grid opens on its latest day, so a picked day weeks back sat out of sight, or under the sticky
  // engine mark or count. Its square is brought between them, sideways only - the page itself does not move.
  useEffect(() => {
    const sc = document.getElementById("strip-scroll");
    const sq = sc?.querySelector<HTMLElement>('[aria-current="true"]');
    const row = sq?.closest(".app-strip-row");
    if (!sc || !sq || !row) return;
    const from = row.querySelector(".app-strip-lab")?.getBoundingClientRect().right ?? sc.getBoundingClientRect().left;
    const to = row.querySelector(".app-strip-n")?.getBoundingClientRect().left ?? sc.getBoundingClientRect().right;
    const q = sq.getBoundingClientRect();
    if (q.left >= from && q.right <= to) return;
    sc.scrollBy({ left: q.left + q.width / 2 - (from + to) / 2 });
  }, [at]);
  return null;
}
