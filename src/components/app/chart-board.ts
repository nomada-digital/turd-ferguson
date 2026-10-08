/**
 * The Overview chart's board (OverviewChart.tsx): its geometry, where its
 * readout goes for a day, and which day a point along it is. Pure, and in a
 * module of its own so chart-board.test.mts can hold it (8 Oct 2026, audit
 * mobile-2 review) - the component is TSX, which the test runner cannot load.
 *
 * The board is drawn 1056 wide in viewBox units and scaled to the plot's
 * width, which is 880 to 1056px wherever it is drawn (globals.css, .app-ovc:
 * below an 880px plot the card draws Compact instead).
 */

export const W = 1056;
export const H = 300;
export const X0 = 40;
export const X1 = 1044;
export const Y0 = 264;
export const Y1 = 16;

/**
 * The readout's drawn width: 220px, its 12px 14px padding inside it (every box
 * is border-box, globals.css), as it has been since T4. The mobile-2 change
 * had widened it to 248 by mistake (review, 8 Oct 2026).
 */
export const READOUT_W = 220;

/** The gap between a day's line and the readout beside it. */
const GAP = 12;

/** A day's x on the board, in viewBox units, for `n` days. */
export function boardX(i: number, n: number): number {
  return X0 + i * (n > 1 ? (X1 - X0) / (n - 1) : 0);
}

/**
 * Where the readout goes for a day at board x: 12px right of the day's line,
 * or 12px left when that would pass the plot's right edge, and never past its
 * left one. In pixels from the plot's measured width; before that is known
 * (the first render, or JS off), the T4 guess in percent.
 */
export function readoutAt(x: number, plotW: number | null): { left: string; transform?: string } {
  if (!plotW) return { left: `${(x / W) * 100}%`, transform: x > 780 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" };
  const px = (x / W) * plotW;
  const left = px + GAP + READOUT_W <= plotW ? px + GAP : Math.max(0, px - GAP - READOUT_W);
  return { left: `${Math.round(left)}px` };
}

/**
 * The strip of day buttons over the board, as its left and right edges in
 * viewBox units: one step per day, each button centred on its day's line. On a
 * short range half a step is wider than the plot's margins, so the end buttons
 * run past the plot; the card clips sideways, which only cuts them short.
 *
 * 8 Oct 2026 (review of audit mobile-2): since T4 the strip ended half a step
 * short of the last line rather than half a step past it, so its 28 buttons
 * shared 27 steps and drifted left of their lines - the last day's button sat
 * over the line before it, and the last line itself had none. A slide, which
 * picks the nearest line, disagreed with a hover by a day.
 */
export function dayStrip(n: number): { left: number; right: number } {
  if (n <= 1) return { left: X0, right: X1 };
  const step = (X1 - X0) / (n - 1);
  return { left: X0 - step / 2, right: X1 + step / 2 };
}

/**
 * The day under a point `frac` of the way across the plot (0 at its left
 * edge, 1 at its right), for `n` days: the nearest day's line, which is the
 * day whose button covers that point (dayStrip). A touch sliding along the
 * board picks days with it, as it does on Compact.
 */
export function boardDayAt(frac: number, n: number): number {
  if (n <= 1) return 0;
  const step = (X1 - X0) / (n - 1);
  return Math.max(0, Math.min(n - 1, Math.round((frac * W - X0) / step)));
}
