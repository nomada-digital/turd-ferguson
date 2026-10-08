import { T } from "@/config/tokens";

const pos = (p: number | null | undefined) => (p ? `#${p}` : "outside the top 100");

/**
 * Keywords with their Google position at the start and now, and monthly
 * searches when known - "reached page 1" and "biggest climbs" (M3, 8 Oct
 * 2026, from the hub case studies). `.cs-row` in globals.css lays a row out.
 */
export default function KeywordMoves({ rows }: { rows: { k: string; vol?: number | null; then?: number | null; now?: number | null }[] }) {
  return (
    <div style={{ marginTop: "10px" }}>
      {rows.map((k) => (
        <div key={k.k} className="cs-row" style={{ borderTop: "1px solid " + T.hair }}>
          <span style={{ fontSize: "14px", color: T.ink }}>{k.k}</span>
          <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, flexShrink: 0, maxWidth: "100%" }}>
            {pos(k.then)} to {pos(k.now)}
            {k.vol ? <span style={{ fontWeight: 400, color: T.soft }}> - {k.vol.toLocaleString("en-US")} searches a month</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
