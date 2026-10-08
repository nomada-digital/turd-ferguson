import { T } from "@/config/tokens";
import { longDate } from "@/lib/long-date";

import { niceStep } from "./scale";

/**
 * A line over time, one point per reading, drawn as inline SVG so a page needs
 * no chart library (M3, 8 Oct 2026: lifted from the hub case studies so the
 * dashboard draws the same idea the same way).
 *
 * `count` is a figure with its own scale (keywords on page 1, monthly
 * searches); `percent` is a share of answers, scaled to the nearest 10% above
 * the highest reading with 20% as the floor. `ariaLabel` is the sentence a
 * screen reader hears in place of the drawing - the start and the end, with
 * their dates - and the caller writes it, because only the caller knows what
 * the figure is.
 */
export default function TrendLine({ points, mode, caption, ariaLabel }: { points: { d: string; v: number }[]; mode: "count" | "percent"; caption: string; ariaLabel: string }) {
  const percent = mode === "percent";
  const W = 640, H = percent ? 180 : 200, L = percent ? 40 : 52, B = 26, top = 12;
  const max = Math.max(...points.map((p) => p.v));
  let yMax: number;
  let ticks: number[];
  if (percent) {
    yMax = Math.min(100, Math.max(20, Math.ceil(max / 10) * 10 + 10));
    ticks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10).filter((t) => t % (yMax > 50 ? 20 : 10) === 0);
  } else {
    const step = niceStep(Math.max(1, max));
    yMax = Math.ceil(Math.max(1, max) / step) * step;
    ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  }
  const x = (i: number) => L + (i / Math.max(1, points.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const first = points[0]!, last = points[points.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{percent ? `${t}%` : t.toLocaleString("en-US")}</text>
          </g>
        ))}
        <polyline points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
          fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={p.d} cx={x(i)} cy={y(p.v)} r="3" fill={T.accent} />)}
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>{caption}</figcaption>
    </figure>
  );
}
