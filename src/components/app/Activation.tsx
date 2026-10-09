import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import type { ActivationStep } from "@/lib/tracking/activation";

/**
 * The activation checklist (ON-3, 9 Oct 2026, LB8) at the top of the
 * Overview: the four steps activation.ts works out on the server, in order.
 * An ordered list, so a screen reader hears four steps and where each stands;
 * each says "Done" or "To do" in words beside its tick, never by colour alone,
 * and links to where it is done. It wraps rather than scrolls at 390px.
 */
export default function Activation({ steps }: { steps: readonly ActivationStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <section aria-labelledby="act-h" className="app-activation" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "18px 22px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px", flexWrap: "wrap" }}>
        <h2 id="act-h" style={{ margin: 0, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
          Getting started
        </h2>
        <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{`${done} of ${steps.length} done`}</span>
      </div>
      {/* role="list" because Safari drops list semantics with list-style none (as NextSteps.tsx). */}
      <ol role="list" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
        {steps.map((s, i) => (
          <li key={s.id} data-step={s.id} data-done={s.done ? "yes" : "no"} style={{ display: "flex", alignItems: "flex-start", gap: "12px", paddingTop: i ? "10px" : 0, borderTop: i ? `1px solid ${T.hair}` : undefined, minWidth: 0 }}>
            <span aria-hidden="true" style={{ flexShrink: 0, width: "22px", height: "22px", marginTop: "1px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", background: s.done ? T.goodBg : T.surface, border: `1.5px solid ${s.done ? T.goodFg : T.line}` }}>
              {s.done ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.goodFg} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : (
                <span style={{ fontSize: "11px", fontWeight: 700, color: T.soft }}>{i + 1}</span>
              )}
            </span>
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 16px", flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", flex: "1 1 260px", minWidth: 0 }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>
                  {/* A real space, so the status is its own word to a screen reader, not "setupDone". */}
                  {`${s.title} `}
                  <span style={{ marginLeft: "4px", padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", background: s.done ? T.goodBg : T.chip, color: s.done ? T.goodFg : T.ink }}>{s.done ? "Done" : "To do"}</span>
                </span>
                {/* Compact once done: the step and its link stay, its sentence goes. */}
                {s.done ? null : <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, overflowWrap: "anywhere" }}>{s.detail}</span>}
              </span>
              <Link href={s.href} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
                {s.link}
                <span className="sr-only">{`: ${s.title}`}</span>
              </Link>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
