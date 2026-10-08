import { T } from "@/config/tokens";

/**
 * Start against now, as paired bars on one scale - each row its own
 * denominator when it has one (per-engine answers), else the shared `of`
 * (M3, 8 Oct 2026, from the hub case studies).
 */
export default function StartNowBars({ rows, of, unit }: { rows: { l: string; then: number; now: number; of?: number }[]; of: number; unit: string }) {
  const pc = (n: number, d: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, d)) * 100))}%`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {rows.map((r) => (
        <div key={r.l}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: T.ink }}>
            <span>{r.l}</span>
            <span style={{ fontWeight: 600 }}>{r.then} to {r.now} <span style={{ fontWeight: 400, color: T.soft }}>of {r.of ?? of} {unit}</span></span>
          </div>
          <div aria-hidden="true" style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ height: "8px", borderRadius: "4px", background: T.chip }}>
              <div style={{ width: pc(r.then, r.of ?? of), height: "100%", borderRadius: "4px", background: T.faint }} />
            </div>
            <div style={{ height: "8px", borderRadius: "4px", background: T.chip }}>
              <div style={{ width: pc(r.now, r.of ?? of), height: "100%", borderRadius: "4px", background: T.accent }} />
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: T.soft }}>
        <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.faint, marginRight: "6px" }} />At the start</span>
        <span><span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "3px", background: T.accent, marginRight: "6px" }} />Now</span>
      </div>
    </div>
  );
}
