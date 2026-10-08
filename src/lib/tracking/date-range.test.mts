import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bounds,
  calendarHint,
  compareText,
  monthCells,
  moveDay,
  pickDay,
  presetOf,
  presets,
  rangeLabel,
  rangeQuery,
  summary,
  viewFor,
} from "./date-range.ts";

// T5 part 1 (30 Sep 2026): the picker's rules against boards/DatePicker.dc.html,
// whose state is today 29 Sep 2026, tracking began 4 Jul 2026, last 28 days.
const TODAY = "2026-09-29";
const BEGAN = "2026-07-04";
const B = bounds(TODAY, BEGAN);

test("the six presets are the board's, clamped to the day tracking began", () => {
  const p = presets(TODAY, BEGAN);
  assert.deepEqual(
    p.map((x) => [x.label, x.hint, x.range.from, x.range.to]),
    [
      ["Last 7 days", "", "2026-09-23", TODAY],
      ["Last 28 days", "", "2026-09-02", TODAY],
      ["Last 90 days", "from 4 Jul", BEGAN, TODAY],
      ["This month", "", "2026-09-01", TODAY],
      ["August", "", "2026-08-01", "2026-08-31"],
      ["Since tracking began", "4 Jul", BEGAN, TODAY],
    ],
  );
});

test("last month in January is December of the year before", () => {
  const lm = presets("2027-01-10", "2026-07-04").find((p) => p.id === "lm")!;
  assert.deepEqual([lm.label, lm.range], ["December", { from: "2026-12-01", to: "2026-12-31" }]);
});

test("the trigger names the preset a range is, else counts its days", () => {
  assert.equal(rangeLabel({ from: "2026-09-02", to: TODAY }, TODAY, BEGAN), "Last 28 days");
  assert.equal(rangeLabel({ from: "2026-09-10", to: "2026-09-12" }, TODAY, BEGAN), "3 days");
  // A young client's 28 days is still "Last 28 days"; the first preset that fits wins.
  assert.equal(presetOf({ from: "2026-09-25", to: TODAY }, TODAY, "2026-09-25")?.id, "l7");
});

test("click a start, then an end, either way round; disabled days do nothing", () => {
  let s = { from: "2026-09-02", to: TODAY, picking: false };
  s = pickDay(s, "2026-09-10", B);
  assert.deepEqual(s, { from: "2026-09-10", to: "2026-09-10", picking: true });
  assert.equal(summary(s), "Choose an end date");
  s = pickDay(s, "2026-08-20", B);
  assert.deepEqual(s, { from: "2026-08-20", to: "2026-09-10", picking: false });
  assert.equal(summary(s), "20 Aug - 10 Sep 2026, 22 days");
  assert.deepEqual(pickDay(s, "2026-09-30", B), s, "after today");
  assert.deepEqual(pickDay(s, "2026-07-03", B), s, "before tracking began");
});

test("arrow keys move a day or a week and stay inside the bounds", () => {
  assert.equal(moveDay("2026-09-10", "ArrowRight", B), "2026-09-11");
  assert.equal(moveDay("2026-09-10", "ArrowUp", B), "2026-09-03");
  assert.equal(moveDay("2026-09-27", "ArrowDown", B), TODAY);
  assert.equal(moveDay(BEGAN, "ArrowLeft", B), BEGAN);
  assert.equal(moveDay("2026-09-10", "Enter", B), null);
});

test("the calendar shows the range's end month on the right, never before the month after tracking began", () => {
  assert.deepEqual(viewFor(TODAY, B), { view: "2026-09", minView: "2026-08", maxView: "2026-09" });
  assert.equal(viewFor("2026-07-10", B).view, "2026-08");
  // Tracking began this month: the left month is last month, all disabled.
  assert.deepEqual(viewFor(TODAY, bounds(TODAY, "2026-09-20")), { view: "2026-09", minView: "2026-09", maxView: "2026-09" });
});

test("September 2026 on the board: Tuesday first, today ringed, the band rounded at its ends and week edges", () => {
  const { title, cells } = monthCells("2026-09", { from: "2026-09-02", to: TODAY, picking: false }, B);
  assert.equal(title, "September 2026");
  assert.equal(cells.filter((c) => c.blank).length, 2);
  const day = (n: number) => cells.find((c) => !c.blank && c.n === n)! as Extract<(typeof cells)[number], { blank: false }>;
  assert.equal(day(1).band, false);
  assert.deepEqual([day(2).end, day(2).roundLeft, day(2).roundRight], [true, true, false]);
  assert.deepEqual([day(5).roundRight, day(6).roundLeft], [true, true], "Saturday and Sunday edges");
  assert.deepEqual([day(29).end, day(29).today, day(29).roundRight], [true, true, true]);
  assert.deepEqual([day(30).disabled, day(30).aria], [true, "30 September 2026, no data"]);
  // Mid-pick there is no band, only the one chosen day.
  const mid = monthCells("2026-09", { from: "2026-09-10", to: "2026-09-10", picking: true }, B).cells.filter((c) => !c.blank && (c.band || c.end));
  assert.deepEqual(mid.map((c) => !c.blank && c.n), [10]);
});

test("the compare line in the board's words, flagging a period before tracking began", () => {
  const r = { from: "2026-09-02", to: TODAY };
  assert.equal(compareText(r, "prev", BEGAN), "Compared with 5 Aug - 1 Sep, the 28 days before.");
  assert.equal(compareText(r, "month", BEGAN), "Compared with 2 Aug - 29 Aug.");
  assert.equal(compareText(r, "none", BEGAN), "No comparison. The chart shows this period only.");
  // 8 Oct 2026 (audit data-10): a period reaching back before tracking began is replaced by the first week, as every
  // page now reads it - it used to be compared with and then hidden, so a client saw no change for 55 days.
  assert.equal(compareText({ from: "2026-07-20", to: TODAY }, "prev", BEGAN), "Tracking began 4 Jul, so this compares with your first week, 4 Jul - 10 Jul.");
  assert.equal(compareText({ from: "2026-07-04", to: "2026-07-09" }, "prev", BEGAN), "Tracking began 4 Jul, so there is no earlier period to compare with yet.");
});

test("the hint, and the query Apply writes - the shape rangeFrom reads", () => {
  assert.equal(calendarHint(B, BEGAN), "Tracking began 4 Jul 2026. Today, 29 Sep, is ringed. Pick a start day, then an end day.");
  assert.deepEqual(rangeQuery({ from: "2026-09-02", to: TODAY }, "prev"), { from: "2026-09-02", to: TODAY });
  assert.deepEqual(rangeQuery({ from: "2026-09-02", to: TODAY }, "none"), { from: "2026-09-02", to: TODAY, compare: "none" });
});
