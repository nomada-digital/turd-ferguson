import { type Day, type Range, addDays, comparisonRange, daysIn, formatDay, resolveComparison } from "./figures.ts";

/**
 * The date range picker's rules (T5 part 1, 30 Sep 2026; BRIEF T5 against
 * boards/DatePicker.dc.html - boards-3 has no picker, and BRIEF-3 changes
 * nothing but "one range for the prompts and the keyword alike"). Pure and
 * unwired: the presets, the two-month calendar's cells, the summary and the
 * compare line in the board's words, the click-start-then-end rule, the
 * arrow keys, and the query Apply writes - the same `?from=&to=&compare=`
 * that `rangeFrom` reads.
 *
 * Days before `started_on` or after today are disabled; with no
 * `started_on` yet only today can be picked.
 */

export type Compare = "prev" | "month" | "none";

export type Bounds = { min: Day; max: Day };

export const bounds = (today: Day, startedOn: Day | null): Bounds => ({ min: startedOn && startedOn <= today ? startedOn : today, max: today });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const clamp = (d: Day, b: Bounds): Day => (d < b.min ? b.min : d > b.max ? b.max : d);

export type Preset = { id: "l7" | "l28" | "l90" | "mtd" | "lm" | "all"; label: string; hint: string; range: Range };

/**
 * The board's six presets. A preset that reaches back before tracking began
 * starts on `started_on` instead and says so ("from 4 Jul"); "Last month" is
 * named for the month, as the board's "August".
 */
export function presets(today: Day, startedOn: Day | null): Preset[] {
  const b = bounds(today, startedOn);
  const back = (n: number): { range: Range; hint: string } => {
    const from = addDays(today, -(n - 1));
    return from < b.min ? { range: { from: b.min, to: today }, hint: `from ${formatDay(b.min)}` } : { range: { from, to: today }, hint: "" };
  };
  const monthStart = `${today.slice(0, 8)}01`;
  const lastEnd = addDays(monthStart, -1);
  const lastStart = `${lastEnd.slice(0, 8)}01`;
  return [
    { id: "l7", label: "Last 7 days", ...back(7) },
    { id: "l28", label: "Last 28 days", ...back(28) },
    { id: "l90", label: "Last 90 days", ...back(90) },
    { id: "mtd", label: "This month", hint: "", range: { from: clamp(monthStart, b), to: today } },
    { id: "lm", label: MONTHS[Number(lastEnd.slice(5, 7)) - 1]!, hint: "", range: { from: clamp(lastStart, b), to: clamp(lastEnd, b) } },
    { id: "all", label: "Since tracking began", hint: formatDay(b.min), range: { from: b.min, to: today } },
  ];
}

/** The preset a range is, if any - first match wins, so a young client's 28 days reads "Last 28 days", not "Since tracking began". */
export function presetOf(r: Range, today: Day, startedOn: Day | null): Preset | null {
  return presets(today, startedOn).find((p) => p.range.from === r.from && p.range.to === r.to) ?? null;
}

/** The trigger's bold line: the preset's name, else "N days" (as Overview printed before T5). */
export function rangeLabel(r: Range, today: Day, startedOn: Day | null): string {
  const n = daysIn(r).length;
  return presetOf(r, today, startedOn)?.label ?? `${n} ${n === 1 ? "day" : "days"}`;
}

/** Picking state: `picking` is true between the first click (start) and the second (end). */
export type Pick = { from: Day; to: Day; picking: boolean };

/** Click a day: the first click starts a range on it, the second ends it, either way round. A disabled day does nothing. */
export function pickDay(s: Pick, day: Day, b: Bounds): Pick {
  if (day < b.min || day > b.max) return s;
  if (!s.picking) return { from: day, to: day, picking: true };
  return day < s.from ? { from: day, to: s.from, picking: false } : { from: s.from, to: day, picking: false };
}

/** Arrow keys between days (BRIEF T5): a day either way, a week up or down, held inside the bounds. Null for any other key. */
export function moveDay(day: Day, key: string, b: Bounds): Day | null {
  const step = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -7 : key === "ArrowDown" ? 7 : null;
  return step === null ? null : clamp(addDays(day, step), b);
}

/** A month as `YYYY-MM`, and the month n either side. */
export const monthOf = (d: Day) => d.slice(0, 7);
export function addMonths(m: string, n: number): string {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/**
 * The right-hand month shown (the left is the one before): the range's end
 * month, never before the month after tracking began - so the left month is
 * the first with data - and never after today's month.
 */
export function viewFor(to: Day, b: Bounds): { view: string; minView: string; maxView: string } {
  const maxView = monthOf(b.max);
  const floor = addMonths(monthOf(b.min), 1);
  const minView = floor > maxView ? maxView : floor;
  const m = monthOf(to);
  return { view: m < minView ? minView : m > maxView ? maxView : m, minView, maxView };
}

export type Cell =
  | { blank: true }
  | {
      blank: false;
      day: Day;
      n: number;
      disabled: boolean;
      /** The range's first or last day: the filled purple day. */
      end: boolean;
      /** On the tinted band between the ends; its rounded sides at the range's ends, week edges and month edges. */
      band: boolean;
      roundLeft: boolean;
      roundRight: boolean;
      /** Today, ringed unless it is an end. */
      today: boolean;
      aria: string;
    };

/** One month of the calendar, Sunday first as on the board, with leading blanks. */
export function monthCells(month: string, s: Pick, b: Bounds): { title: string; cells: Cell[] } {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lo = s.from;
  const hi = s.picking ? s.from : s.to;
  const cells: Cell[] = Array.from({ length: lead }, () => ({ blank: true as const }));
  for (let n = 1; n <= days; n++) {
    const day = `${month}-${String(n).padStart(2, "0")}`;
    const disabled = day < b.min || day > b.max;
    const end = day === lo || day === hi;
    const band = !s.picking && lo !== hi && day >= lo && day <= hi;
    const col = (lead + n - 1) % 7;
    cells.push({
      blank: false,
      day,
      n,
      disabled,
      end,
      band,
      roundLeft: band && (day === lo || col === 0 || n === 1),
      roundRight: band && (day === hi || col === 6 || n === days),
      today: day === b.max,
      aria: `${n} ${MONTHS[m - 1]} ${y}${disabled ? ", no data" : ""}`,
    });
  }
  return { title: `${MONTHS[m - 1]} ${y}`, cells };
}

/** The footer's bold line: "2 Sep - 29 Sep 2026, 28 days", or the prompt for the second click. */
export function summary(s: Pick): string {
  if (s.picking) return "Choose an end date";
  const n = daysIn({ from: s.from, to: s.to }).length;
  return `${formatDay(s.from)} - ${formatDay(s.to, true)}, ${n} ${n === 1 ? "day" : "days"}`;
}

export const COMPARE_OPTIONS: { id: Compare; label: string }[] = [
  { id: "prev", label: "Previous period" },
  { id: "month", label: "Month before" },
  { id: "none", label: "Nothing" },
];

/** The compare control's one-line explanation, in the board's words; the comparison range is `comparisonRange`'s, as the figures read it. */
export function compareText(r: Range, compare: Compare, startedOn: Day | null): string {
  const c = comparisonRange(r, compare);
  if (!c) return "No comparison. The chart shows this period only.";
  const span = `${formatDay(c.from)} - ${formatDay(c.to)}`;
  // 8 Oct 2026 (audit data-10): a period reaching back before tracking began is replaced by the first week, as every page reads it.
  if (startedOn && c.from < startedOn) {
    const first = resolveComparison(r, compare, startedOn).range;
    return first
      ? `Tracking began ${formatDay(startedOn)}, so this compares with your first week, ${formatDay(first.from)} - ${formatDay(first.to)}.`
      : `Tracking began ${formatDay(startedOn)}, so there is no earlier period to compare with yet.`;
  }
  return compare === "prev" ? `Compared with ${span}, the ${daysIn(r).length} days before.` : `Compared with ${span}.`;
}

/** The calendar's hint line under the months. */
export function calendarHint(b: Bounds, startedOn: Day | null): string {
  const began = startedOn && startedOn <= b.max ? `Tracking began ${formatDay(startedOn, true)}. ` : "";
  return `${began}Today, ${formatDay(b.max)}, is ringed. Pick a start day, then an end day.`;
}

/** What Apply writes: `from`, `to`, and `compare` only when it is not the default `prev` - the same shape Overview's links carry. */
export function rangeQuery(r: Range, compare: Compare): Record<string, string> {
  return { from: r.from, to: r.to, ...(compare === "prev" ? {} : { compare }) };
}
