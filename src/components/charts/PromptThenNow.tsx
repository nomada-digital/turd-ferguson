import { T } from "@/config/tokens";

export type EngineThenNow = { e: string; then?: boolean | null; now: boolean; pos?: number | null; of?: number | null };

/**
 * One tracked prompt: what each engine said at the start of the window and
 * what it says now, with the position in the answer when it names you
 * (M3, 8 Oct 2026, from the hub case studies).
 */
export default function PromptThenNow({ prompt, engines }: { prompt: string; engines: EngineThenNow[] }) {
  const mark = (v?: boolean | null) => (v == null ? "not asked yet" : v ? "named" : "not named");
  return (
    <div style={{ border: "1px solid " + T.line, borderRadius: "12px", padding: "16px 18px", background: T.surface }}>
      <div style={{ fontSize: "14.5px", fontWeight: 600, color: T.ink }}>&ldquo;{prompt}&rdquo;</div>
      <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
        {engines.map((e) => (
          <div key={e.e} style={{ borderRadius: "10px", padding: "8px 10px", background: e.now ? T.wash : T.chip, border: "1px solid " + (e.now ? T.washLine : T.line) }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: e.now ? T.accent : T.soft }}>{e.e}</div>
            <div style={{ fontSize: "12px", color: T.soft, marginTop: "2px" }}>
              {e.now ? `Named${e.pos ? ` #${e.pos}${e.of ? ` of ${e.of}` : ""}` : ""}` : "Not named"}
            </div>
            <div style={{ fontSize: "11.5px", color: T.faint, marginTop: "2px" }}>At the start: {mark(e.then)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
