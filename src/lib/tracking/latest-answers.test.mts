import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture } from "./fixture-mode.ts";
import { type LatestRow, answerTabs, brandRuns, checkTime, engineTab, pageLabel, withoutLinks } from "./latest-answers.ts";

/**
 * T7 part 3b (30 Sep 2026; boards-3/QuestionDetail.dc.html "Latest answers"):
 * the tabs, the link-free text, the page labels and the brand highlight.
 * Stubbed rows, then the fixture's today for one prompt.
 */

const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const row = (over: Partial<LatestRow>): LatestRow => ({ engine: "chatgpt", answered: true, named: false, text: "An answer.", brands: [], citations: [], at: "2026-09-29T05:11:00Z", ...over });

test("one tab per engine in the tier's order; a missing or unanswered engine is 'no answer', not 'not named'", () => {
  const tabs = answerTabs([row({ engine: "gemini", named: true, brands: ["Tallyroo"] }), row({ engine: "chatgpt", answered: false })], ENGINES, "Tallyroo");
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
  const [t] = answerTabs([row({ engine: "google_aio", named: true, brands: ["Ledgerline", "tallyroo", "Sumly", "ledgerline"] })], ["google_aio"], "Tallyroo");
  assert.deepEqual(t!.brands, [
    { name: "Tallyroo", you: true },
    { name: "Ledgerline", you: false },
    { name: "Sumly", you: false },
  ]);
  const [u] = answerTabs([row({ engine: "google_aio", named: false, brands: ["Ledgerline"] })], ["google_aio"], "Tallyroo");
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
  );
  assert.deepEqual(t!.pages, ["example.com/x", "tallyroo.com"]);
});

test("link addresses come out of the text; the words round them stay", () => {
  assert.equal(withoutLinks("See [the guide](https://example.com/g) today."), "See the guide today.");
  assert.equal(withoutLinks("Try Tallyroo (https://tallyroo.com/x) or Sumly <https://example.com>."), "Try Tallyroo or Sumly.");
  assert.equal(withoutLinks("Sources: https://example.com/a https://www.example.com/b"), "Sources:");
  assert.equal(withoutLinks("No links here, 3.5 stars."), "No links here, 3.5 stars.");
});

test("the check's time is London's, where the 06:00 run is set", () => {
  assert.equal(checkTime("2026-09-29T05:10:00Z"), "06:10");
  assert.equal(checkTime("2026-12-01T06:10:00Z"), "06:10");
  assert.equal(checkTime("nonsense"), null);
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
  );
  assert.equal(read!.othersRead, true, "absent brands_ok is read");
  assert.equal(unread!.othersRead, false);
  assert.deepEqual(unread!.brands, []);
  assert.equal(absent!.othersRead, true, "no answer is not a gap");
});
