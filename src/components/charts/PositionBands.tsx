import { T } from "@/config/tokens";
import { longDate } from "@/lib/long-date";

import { niceStep } from "./scale";

export type BandPoint = { d: string; b3?: number; b10?: number; b20?: number };

/**
 * Tracked keywords in Google's top 20 by position band - top 3, 4-10, 11-20 -
 * stacked, one point per reading (M3, 8 Oct 2026: the client dashboards'
 * "search positions over time", lifted from the hub case studies). The
 * caller passes the cadence in `caption`, because a weekly median and a daily
 * reading are different claims.
 */
export default function PositionBands({ series, caption }: { series: BandPoint[]; caption: string }) {
  const W = 640, H = 220, L = 34, B = 26, top = 12;
  const tot = (p: BandPoint) => (p.b3 ?? 0) + (p.b10 ?? 0) + (p.b20 ?? 0);
  const max = Math.max(1, ...series.map(tot));
  const step = niceStep(max);
  const yMax = Math.ceil((max * 1.08) / step) * step;   // headroom: the top band never touches the frame
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (W - L - 8);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - B);
  const layer = (lo: (p: BandPoint) => number, hi: (p: BandPoint) => number) =>
    series.map((p, i) => `${x(i).toFixed(1)},${y(hi(p)).toFixed(1)}`).join(" ") + " " +
    series.map((p, i) => `${x(i).toFixed(1)},${y(lo(p)).toFixed(1)}`).reverse().join(" ");
  const a = (p: BandPoint) => p.b3 ?? 0, b = (p: BandPoint) => a(p) + (p.b10 ?? 0), c = (p: BandPoint) => b(p) + (p.b20 ?? 0);
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const first = series[0]!, last = series[series.length - 1]!;
  const key = (o: number, t: string) => (
    <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.accent, opacity: o, marginRight: "6px" }} />{t}</span>
  );
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Tracked keywords in the top 20 by band: ${tot(first)} on ${longDate(first.d)}, ${tot(last)} on ${longDate(last.d)}, of which ${a(last)} in the top 3`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={T.line} strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={T.soft}>{t}</text>
          </g>
        ))}
        <polygon points={layer(b, c)} fill={T.accent} fillOpacity="0.22" />
        <polygon points={layer(a, b)} fill={T.accent} fillOpacity="0.5" />
        <polygon points={layer(() => 0, a)} fill={T.accent} fillOpacity="0.95" />
        <text x={L} y={H - 6} fontSize="11" fill={T.soft}>{longDate(first.d)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill={T.soft} textAnchor="end">{longDate(last.d)}</text>
      </svg>
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: T.soft, marginTop: "8px" }}>
        {key(0.95, "Top 3")}{key(0.5, "4-10")}{key(0.22, "11-20")}
      </div>
      <figcaption style={{ marginTop: "6px", fontSize: "13px", color: T.soft }}>{caption}</figcaption>
    </figure>
  );
}
