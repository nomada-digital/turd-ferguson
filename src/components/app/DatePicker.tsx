"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { PendingBar } from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import {
  COMPARE_OPTIONS,
  type Cell,
  type Compare,
  type Pick,
  addMonths,
  bounds,
  calendarHint,
  compareText,
  monthCells,
  moveDay,
  pickDay,
  presetOf,
  presets,
  rangeQuery,
  summary,
  viewFor,
} from "@/lib/tracking/date-range";
import type { Day, Range } from "@/lib/tracking/figures";

/**
 * The date range picker (T5 part 2, 30 Sep 2026), as boards/DatePicker.dc.html
 * draws it: presets on the left, two months, the summary and compare control
 * in the foot, Cancel and Apply. Apply writes `?from=&to=&compare=` over the
 * current query (so `?cluster=` stays) and the server page re-reads.
 *
 * The trigger's face is the server's, passed as children, so with JS off the
 * settled range still shows; the button just does nothing. Arrow keys move
 * between days, Esc closes, and on a phone the dialog is a full-height sheet
 * (`.app-dp-*` in globals.css).
 */

const SHADOW = `0 24px 60px -28px color-mix(in srgb, ${T.ink} 45%, transparent)`;
const BTN: React.CSSProperties = { display: "flex", alignItems: "center", height: "44px", padding: "0 16px", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const ARROW: React.CSSProperties = { position: "absolute", top: 0, width: "36px", height: "36px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };

export default function DatePicker({ range, compare, today, startedOn, firstCheck = null, className, grow = true, noCompare = false, children }: { range: Range; compare: Compare; today: Day; startedOn: Day | null; /** The first week's first day as the page reads it (figures.ts firstCheckDay), so the compare line names the same week the page will. */ firstCheck?: Day | null; className?: string; /** Fill the row, as the Overview header does; the cluster pages keep the face its own width. */ grow?: boolean; /** DS25: Placements compares nothing (every span is go-live to now) and Reports' CSVs ignore it (DS26), so the foot drops "Compare with" and Apply writes no compare. */ noCompare?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  // R151: pending while the server re-reads the new range, so Apply shows it took.
  const [loading, startLoading] = useTransition();
  const b = bounds(today, startedOn);
  const [open, setOpen] = useState(false);
  // Open under the face's right edge when there is room to its left (the Overview header), else under its left edge (the one-cluster page, where the face wraps to the left).
  const [left, setLeft] = useState(false);
  const [pick, setPick] = useState<Pick>({ ...range, picking: false });
  const [preset, setPreset] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Compare>(compare);
  const [view, setView] = useState(() => viewFor(range.to, b).view);
  const [focus, setFocus] = useState<Day>(range.to);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const { minView, maxView } = viewFor(range.to, b);

  const reset = () => {
    setPick({ ...range, picking: false });
    setPreset(presetOf(range, today, startedOn)?.id ?? null);
    setCmp(compare);
    setView(viewFor(range.to, b).view);
    setFocus(range.to);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Focus the day once on opening; later moves focus in onDayKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onDayKey = (e: React.KeyboardEvent, day: Day) => {
    const next = moveDay(day, e.key, b);
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    const m = next.slice(0, 7);
    if (m > view) setView(m);
    else if (m < addMonths(view, -1)) setView(addMonths(m, 1) < minView ? minView : addMonths(m, 1));
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };

  const apply = () => {
    if (pick.picking) return;
    const q = new URLSearchParams(window.location.search);
    q.delete("compare");
    for (const [k, v] of Object.entries(rangeQuery({ from: pick.from, to: pick.to }, noCompare ? "prev" : cmp))) q.set(k, v);
    setOpen(false);
    startLoading(() => router.push(`?${q}`));
  };

  const day = (c: Cell, i: number) => {
    if (c.blank) return <span key={`b${i}`} style={{ height: "40px" }} />;
    const r = "10px";
    return (
      <span key={c.day} style={{ height: "40px", display: "flex", background: c.band ? T.wash : "transparent", borderRadius: `${c.roundLeft ? r : 0} ${c.roundRight ? r : 0} ${c.roundRight ? r : 0} ${c.roundLeft ? r : 0}` }}>
        <button
          type="button"
          data-day={c.day}
          tabIndex={c.day === focus ? 0 : -1}
          disabled={c.disabled}
          aria-label={c.aria}
          aria-pressed={c.end}
          onClick={() => {
            setPick((s) => pickDay(s, c.day, b));
            setPreset(null);
            setFocus(c.day);
          }}
          onKeyDown={(e) => onDayKey(e, c.day)}
          style={{ width: "100%", height: "40px", border: 0, borderRadius: r, background: c.end ? T.accent : "transparent", color: c.end ? T.surface : c.disabled ? T.faint : T.ink, fontSize: "14px", fontWeight: c.end ? 700 : 500, cursor: c.disabled ? "not-allowed" : "pointer", fontVariantNumeric: "tabular-nums", boxShadow: c.today && !c.end ? `inset 0 0 0 1.5px ${T.ink}` : "none", fontFamily: "inherit", padding: 0 }}
        >
          {c.n}
        </button>
      </span>
    );
  };

  return (
    // maxWidth: an unshrinking face ran 57px past 320 with 1.4.12 spacing (R151, 3 Oct 2026).
    <div className={className} style={{ position: "relative", display: "flex", flex: grow ? "1 1 auto" : "0 0 auto", maxWidth: "100%" }}>
      <button
        ref={trigger}
        type="button"
        aria-label="Change date range"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={loading || undefined}
        onClick={() => {
          if (!open) {
            reset();
            setLeft((trigger.current?.getBoundingClientRect().right ?? 0) < 728);
          }
          setOpen(!open);
        }}
        style={{ display: "flex", flex: "1 1 auto", alignItems: "center", gap: "12px", height: "48px", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface, color: T.ink, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        {children}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: "auto", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <PendingBar on={loading} />
      {open ? (
        <>
          <div aria-hidden="true" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 29 }} />
          <div ref={dialog} role="dialog" aria-modal="true" aria-label="Choose a date range" className="app-dp" style={{ position: "absolute", ...(left ? { left: 0 } : { right: 0 }), top: "calc(100% + 12px)", zIndex: 30, width: "712px", maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", boxShadow: SHADOW, display: "flex", flexDirection: "column", color: T.ink }}>
            <div className="app-dp-body" style={{ display: "flex" }}>
              <div className="app-dp-presets" style={{ width: "188px", flexShrink: 0, boxSizing: "border-box", padding: "16px 12px", borderRight: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: "2px" }}>
                {presets(today, startedOn).map((p) => {
                  const on = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setPick({ ...p.range, picking: false });
                        setPreset(p.id);
                        setView(viewFor(p.range.to, b).view);
                        setFocus(p.range.to);
                      }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", height: "40px", padding: "0 12px", border: 0, borderRadius: "10px", background: on ? T.wash : "transparent", color: on ? T.accent : T.ink, fontSize: "14px", fontWeight: on ? 700 : 500, textAlign: "left", cursor: "pointer", fontFamily: "inherit", lineHeight: 1.2 }}
                    >
                      {p.label}
                      <span style={{ fontSize: "12px", fontWeight: 500, color: T.soft }}>{p.hint}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ flexGrow: 1, minWidth: 0, padding: "16px 20px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div className="app-dp-months" style={{ position: "relative", display: "flex", gap: "24px" }}>
                  {[addMonths(view, -1), view].map((m) => {
                    const { title, cells } = monthCells(m, pick, b);
                    return (
                      <div key={m} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ height: "36px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: 700 }}>{title}</div>
                        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", fontSize: "12px", fontWeight: 600, color: T.soft, textAlign: "center" }}>
                          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                            <span key={d}>{d}</span>
                          ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", rowGap: "4px" }}>{cells.map(day)}</div>
                      </div>
                    );
                  })}
                  <button type="button" aria-label="Previous month" disabled={view <= minView} onClick={() => setView(addMonths(view, -1))} style={{ ...ARROW, left: 0, opacity: view <= minView ? 0.35 : 1 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 6l-6 6 6 6" />
                    </svg>
                  </button>
                  <button type="button" aria-label="Next month" disabled={view >= maxView} onClick={() => setView(addMonths(view, 1))} style={{ ...ARROW, right: 0, opacity: view >= maxView ? 0.35 : 1 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
                <div style={{ fontSize: "12px", color: T.soft, paddingTop: "6px" }}>{calendarHint(b, startedOn)}</div>
              </div>
            </div>
            <div className="app-dp-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 20px", borderTop: `1px solid ${T.line}`, background: T.surface, borderRadius: "0 0 18px 18px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <div aria-live="polite" style={{ fontSize: "14px", fontWeight: 700 }}>{summary(pick)}</div>
                {noCompare ? null : (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", color: T.soft }}>Compare with</span>
                  <span style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: "10px", background: T.chip }}>
                    {COMPARE_OPTIONS.map((o) => {
                      const on = cmp === o.id;
                      return (
                        <button key={o.id} type="button" aria-pressed={on} onClick={() => setCmp(o.id)} style={{ height: "32px", padding: "0 12px", border: 0, borderRadius: "8px", background: on ? T.surface : "transparent", color: T.ink, fontSize: "13px", fontWeight: 600, boxShadow: on ? `0 1px 2px color-mix(in srgb, ${T.ink} 12%, transparent)` : "none", cursor: "pointer", fontFamily: "inherit" }}>
                          {o.label}
                        </button>
                      );
                    })}
                  </span>
                </div>
                )}
                {noCompare ? null : <div style={{ fontSize: "12px", color: T.soft }}>{pick.picking ? "" : compareText({ from: pick.from, to: pick.to }, cmp, startedOn, firstCheck)}</div>}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={close} style={{ ...BTN, border: `1px solid ${T.line}`, background: T.surface, color: T.ink }}>
                  Cancel
                </button>
                <button type="button" onClick={apply} disabled={pick.picking} style={{ ...BTN, padding: "0 20px", border: 0, background: T.accent, color: T.surface, opacity: pick.picking ? 0.5 : 1 }}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
