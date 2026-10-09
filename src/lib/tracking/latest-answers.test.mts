import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture } from "./fixture-mode.ts";
import { type LatestRow, answerTabs, brandRuns, engineTab, pageLabel, pickedDay, withoutLinks } from "./latest-answers.ts";

/**
 * T7 part 3b (30 Sep 2026; boards-3/QuestionDetail.dc.html "Latest answers"):
 * the tabs, the link-free text, the page labels and the brand highlight.
 * Stubbed rows, then the fixture's today for one prompt.
 */

const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const row = (over: Partial<LatestRow>): LatestRow => ({ engine: "chatgpt", answered: true, named: false, text: "An answer.", brands: [], citations: [], at: "2026-09-29T05:11:00Z", ...over });

test("one tab per engine in the tier's order; a missing or unanswered engine is 'no answer', not 'not named'", () => {
  const tabs = answerTabs([row({ engine: "gemini", named: true, brands: ["Tallyroo"] }), row({ engine: "chatgpt", answered: false })], ENGINES, "Tallyroo", "US");
  assert.deepEqual(
    tabs.map((t) => [t.engine, t.named]),
    [
      ["google_aio", null],
      ["chatgpt", null],
      ["gemini", true],
      ["perplexity", null],
    ],
  );
  assert.equal(tabs[1]!.text, null);
});

test("brands: the client first when named, then the others once each in the engine's order", () => {
  const [t] = answerTabs([row({ engine: "google_aio", named: true, brands: ["Ledgerline", "tallyroo", "Sumly", "ledgerline"] })], ["google_aio"], "Tallyroo", "US");
  assert.deepEqual(t!.brands, [
    { name: "Tallyroo", you: true },
    { name: "Ledgerline", you: false },
    { name: "Sumly", you: false },
  ]);
  const [u] = answerTabs([row({ engine: "google_aio", named: false, brands: ["Ledgerline"] })], ["google_aio"], "Tallyroo", "US");
  assert.deepEqual(u!.brands, [{ name: "Ledgerline", you: false }]);
});

test("pages cited: host and path, no scheme, www, query, fragment or trailing slash, each once", () => {
  assert.equal(pageLabel("https://www.Example.com/a/b/?utm=1#x"), "example.com/a/b");
  assert.equal(pageLabel("example.com"), "example.com");
  assert.equal(pageLabel("not a url"), null);
  const [t] = answerTabs(
    [row({ citations: [{ source_domain: "example.com", url: "https://example.com/x/" }, { source_domain: "example.com", url: "http://www.example.com/x?y=1" }, { source_domain: "tallyroo.com", url: null }] })],
    ["chatgpt"],
    "Tallyroo",
    "US",
  );
  assert.deepEqual(t!.pages, ["example.com/x", "tallyroo.com"]);
});

test("link addresses come out of the text; the words round them stay", () => {
  assert.equal(withoutLinks("See [the guide](https://example.com/g) today."), "See the guide today.");
  assert.equal(withoutLinks("Try Tallyroo (https://tallyroo.com/x) or Sumly <https://example.com>."), "Try Tallyroo or Sumly.");
  assert.equal(withoutLinks("Sources: https://example.com/a https://www.example.com/b"), "Sources:");
  assert.equal(withoutLinks("No links here, 3.5 stars."), "No links here, 3.5 stars.");
});

test("9 Oct 2026 (audit copy-2): an answer's time is the client's own, with its zone - not London's for everyone", () => {
  // It was London wall-clock with no zone, shown to US clients too.
  const at = (market: string, iso: string) => answerTabs([row({ at: iso })], ["chatgpt"], "Tallyroo", market)[0]!.time;
  assert.equal(at("UK", "2026-09-29T05:10:00Z"), "06:10 UK time");
  assert.equal(at("UK", "2026-12-01T05:10:00Z"), "05:10 UK time");
  assert.equal(at("US", "2026-09-29T05:10:00Z"), "1:10am ET");
  assert.equal(at("US", "2026-12-01T05:10:00Z"), "12:10am ET");
  assert.equal(at("UK", "nonsense"), null);
});

test("the brand highlight takes whole words only, any case", () => {
  assert.deepEqual(brandRuns("Tallyroo, tallyroo's and Tallyrooz", "Tallyroo"), [
    { text: "Tallyroo", brand: true },
    { text: ", ", brand: false },
    { text: "tallyroo", brand: true },
    { text: "'s and Tallyrooz", brand: false },
  ]);
  assert.deepEqual(brandRuns("a.b", "a.b"), [{ text: "a.b", brand: true }]);
});

test("?engine= picks an engine of the tier, anything else the first", () => {
  assert.equal(engineTab("gemini", ENGINES), "gemini");
  assert.equal(engineTab("claude", ENGINES), "google_aio");
  assert.equal(engineTab(["gemini"], ENGINES), "google_aio");
  assert.equal(engineTab(undefined, ENGINES), "google_aio");
});

test("DB-2 (9 Oct 2026): ?day= is a real day from tracking's start to today; anything else is none, never an error", () => {
  const today = "2026-09-29";
  const started = "2026-06-10";
  assert.equal(pickedDay("2026-09-22", today, started), "2026-09-22");
  assert.equal(pickedDay(today, today, started), today, "today");
  assert.equal(pickedDay(started, today, started), started, "the day tracking began");
  assert.equal(pickedDay("2026-09-30", today, started), null, "tomorrow");
  assert.equal(pickedDay("2026-06-09", today, started), null, "the day before tracking began");
  assert.equal(pickedDay("2026-09-22", today, null), null, "a client not started");
  for (const bad of ["2026-09-31", "2026-02-29", "2026-9-22", "22 Sep 2026", "2026-09-22T00:00", " 2026-09-22", "", "1900-01-01"]) {
    assert.equal(pickedDay(bad, today, started), null, bad);
  }
  assert.equal(pickedDay(["2026-09-22"], today, started), null, "the key given twice");
  assert.equal(pickedDay(undefined, today, started), null);
  assert.equal(pickedDay("2028-02-29", "2028-03-01", started), "2028-02-29", "a leap day is a day");
});

test("fixture: the cluster notes (T7 part 4a) survive expansion and sit on c1's prompts", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const c1 = new Set(fx.data.questions.filter((q) => q.cluster_id === "c1").map((q) => q.id));
  assert.deepEqual(fx.clusterNotes, [{ note_date: "2026-09-09", text: "Freelancer landing page relaunched.", question_id: "q1-1" }]);
  assert.ok(fx.clusterNotes.every((n) => c1.has(n.question_id)));
  assert.equal(fx.data.notes.length, 0, "the overview's notes are untouched");
});

test("fixture: every prompt has words for every engine at today's check, agreeing with the row's verdict and brands", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
  const today = fx.data.answers.filter((a) => a.run_date === fx.today);
  // 45 prompts on 4 engines: c10's five are pending (first check tomorrow).
  assert.equal(today.length, 180);
  let checked = 0;
  for (const a of today) {
    const text = fx.texts[`${a.question_id} ${a.engine}`];
    assert.ok(text, `${a.question_id} ${a.engine} has words`);
    assert.equal(brandRuns(text, "Tallyroo").some((r) => r.brand), a.named, `${a.question_id} ${a.engine}: the words name Tallyroo exactly when the row does`);
    for (const b of a.brands) assert.ok(text.includes(`**${b}**`), `${a.question_id} ${a.engine} names ${b}`);
    checked++;
  }
  assert.ok(checked >= 180);
  const tabs = answerTabs(
    today.filter((a) => a.question_id === "q1-2").map((a) => ({ ...a, text: fx.texts[`q1-2 ${a.engine}`]!, at: `${fx.today}T05:11:00Z` })),
    ENGINES,
    "Tallyroo",
    "US",
  );
  assert.deepEqual(
    tabs.map((t) => t.named),
    [true, true, true, true],
  );
  assert.equal(tabs[1]!.brands[0]!.name, "Tallyroo");
});

test("8 Oct 2026 (audit data-6): an answer whose other brands were not read says so, never 'None'", () => {
  const [read, unread, absent] = answerTabs(
    [row({ engine: "chatgpt", named: true, brands: [] }), row({ engine: "gemini", named: false, brands: [], brands_ok: false })],
    ["chatgpt", "gemini", "perplexity"],
    "Tallyroo",
    "US",
  );
  assert.equal(read!.othersRead, true, "absent brands_ok is read");
  assert.equal(unread!.othersRead, false);
  assert.deepEqual(unread!.brands, []);
  assert.equal(absent!.othersRead, true, "no answer is not a gap");
});
