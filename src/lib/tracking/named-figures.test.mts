import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterSummary } from "./cluster-figures.ts";
import { expandFixture } from "./fixture-mode.ts";
import { type AnswerRow, brandBoard, comparisonRange, overview, shareOfVoice } from "./figures.ts";
import { CITED_WITH_TOP, NAMED_TOP, citedWithBrand, namedPage, openKey } from "./named-figures.ts";

/**
 * R143 (1 Oct 2026; BRIEF-4 P3): the Who is named page reads what the
 * Overview's "Who is named instead" panel reads for the same range - every
 * row's share and change are brandBoard's, the client's share is
 * shareOfVoice's - and adds only depth (engines, prompts, days).
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const range = { from: "2026-09-02", to: fx.today };
const before = comparisonRange(range, "prev");
const you = fx.client.brand ?? fx.client.domain;

test("unfiltered, every row equals the Overview panel's row for the same range", () => {
  const board = brandBoard(fx.data.answers, range, before, you);
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  assert.ok(board.length >= 5, `the fixture names only ${board.length} brands`);
  assert.equal(page.brands, board.length);
  for (const b of board) {
    const row = page.rows.find((r) => r.key === b.key);
    assert.ok(row, `${b.name} missing from the page`);
    assert.deepEqual(row.share, b.share, b.name);
    assert.equal(row.delta, b.delta, b.name);
    assert.equal(row.name, b.name);
  }
  const sov = shareOfVoice(fx.data.answers, range);
  assert.equal(page.rows[0]!.you, true, "own row first");
  assert.equal(page.rows[0]!.share.pct, sov.pct, "the client's share is shareOfVoice's");
});

test("others follow by answers naming them; the headline counts answers in range", () => {
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  const others = page.rows.slice(1);
  for (let i = 1; i < others.length; i++) assert.ok(others[i - 1]!.answers >= others[i]!.answers);
  assert.equal(page.answers, fx.data.answers.filter((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to).length);
  assert.ok(NAMED_TOP === 50);
});

const row = (p: Partial<AnswerRow>): AnswerRow => ({ run_date: "2026-09-10", question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: [], ...p });

test("spellings fold by brandKey, engines and prompt days are counted per brand", () => {
  const answers = [
    row({ brands: ["Xero"], engine: "chatgpt" }),
    row({ brands: ["Xero."], engine: "gemini" }),
    row({ brands: ["Xero"], run_date: "2026-09-11", question_id: "q2" }),
    row({ named: true, question_id: "q2" }),
  ];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-11" }, before: null, you: "Tallyroo" });
  const xero = page.rows.find((r) => r.key === "xero")!;
  assert.equal(xero.answers, 3);
  assert.equal(xero.name, "Xero");
  assert.deepEqual(xero.engines.sort(), ["chatgpt", "gemini"]);
  assert.deepEqual(xero.prompts, [
    { id: "q2", daysNamed: 1, daysAnswered: 2 },
    { id: "q1", daysNamed: 1, daysAnswered: 1 },
  ]);
  assert.equal(page.rows[0]!.name, "Tallyroo");
  assert.equal(page.rows[0]!.answers, 1);
});

test("filters narrow the answers first; a never-named client still has its own row", () => {
  const answers = [row({ brands: ["Xero"], engine: "chatgpt" }), row({ brands: ["Sage"], engine: "gemini" })];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: null, you: "Tallyroo", engine: "gemini" });
  assert.deepEqual(page.rows.map((r) => r.name), ["Tallyroo", "Sage"]);
  assert.equal(page.rows[0]!.answers, 0);
  assert.equal(page.rows[0]!.share.pct, 0);
  const none = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: null, you: "Tallyroo", only: new Set(["other"]) });
  assert.equal(none.rows.length, 1);
  assert.equal(none.rows[0]!.share.pct, null, "no readings: no figure, not 0%");
});

test("'New' is a brand with no mention in the comparison range", () => {
  const answers = [row({ brands: ["Xero"], run_date: "2026-09-01" }), row({ brands: ["Xero", "Sage"] })];
  const page = namedPage({ answers, range: { from: "2026-09-10", to: "2026-09-10" }, before: { from: "2026-09-01", to: "2026-09-01" }, you: "T" });
  assert.equal(page.rows.find((r) => r.key === "sage")!.isNew, true);
  assert.equal(page.rows.find((r) => r.key === "xero")!.isNew, false);
});

test("R173: pages cited with a brand come only from answers naming it, under the same filters", () => {
  const cite = (url: string) => ({ source_domain: new URL(url).hostname, url });
  const answers = [
    { ...row({ brands: ["Ledgerline"] }), citations: [cite("https://www.ledgerline.com/pricing/"), cite("https://softwarecritic.com/x")] },
    { ...row({ brands: ["Ledgerline."], engine: "gemini" }), citations: [cite("https://ledgerline.com/pricing")] },
    { ...row({ brands: ["Sumly"] }), citations: [cite("https://ownerledger.co/")] },
    { ...row({ named: true }), citations: [cite("https://tallyroo.com/")] },
    { ...row({ brands: ["Ledgerline"], answered: false }), citations: [cite("https://thesmallbizstack.com/")] },
  ];
  const r = { from: "2026-09-10", to: "2026-09-10" };
  const ll = citedWithBrand({ answers, range: r, key: "ledgerline", you: "Tallyroo", domain: "tallyroo.com" });
  assert.deepEqual(ll.map((p) => [p.page, p.count]), [["ledgerline.com/pricing", 2], ["softwarecritic.com/x", 1]]);
  assert.deepEqual(citedWithBrand({ answers, range: r, key: "ledgerline", you: "Tallyroo", domain: "tallyroo.com", engine: "gemini" }).map((p) => p.page), ["ledgerline.com/pricing"]);
  const own = citedWithBrand({ answers, range: r, key: "tallyroo", you: "Tallyroo", domain: "tallyroo.com" });
  assert.deepEqual(own.map((p) => [p.page, p.yours]), [["tallyroo.com", true]]);
  assert.ok(fx.data.answers.length && CITED_WITH_TOP === 3);
});

test("?open= takes a folded key only", () => {
  assert.equal(openKey("xero"), "xero");
  assert.equal(openKey("Xero"), null);
  assert.equal(openKey("<x>"), null);
  assert.equal(openKey(["xero"]), null);
});

test("8 Oct 2026 (audit ia-3): the Overview's card reads answers naming each brand, of the headline's own answers", () => {
  const o = overview({ range, compare: "prev", startedOn: fx.client.started_on, engines: [], questions: fx.data.questions, answers: fx.data.answers, serp: fx.data.serp, keywordCount: 9 });
  const cs = clusterSummary(clusterCards({ ...fx.data, range, before: o.compare, today: fx.today, engines: [] }));
  const page = namedPage({ answers: fx.data.answers, range, before, you });
  // One denominator for the headline and the card: 4,760 answers.
  assert.equal(page.answers, o.named.den);
  assert.equal(page.answers, cs.now.den, "the headline by cluster");
  const row = (name: string) => page.rows.find((r) => r.name === name)!;
  assert.deepEqual(row(you).reach, cs.now, "the client's row is the headline's 27%, 1,272 of 4,760");
  // On the mention basis the card read Ledgerline 34% (22% on the long state) and Tallyroo 15% - under a headline of 27%.
  assert.deepEqual([row("Ledgerline").reach.num, row("Ledgerline").reach.den, row("Ledgerline").reach.pct], [2924, 4760, 61]);
  assert.equal(row("Brightbook").reach.pct, 50);
  assert.deepEqual([row("Ledgerline").share.num, row("Ledgerline").share.pct, row(you).share.pct], [2924, 34, 15], "/named's share of mentions is unchanged");
  // Each row's reach counts the same answers as its Answers column on /named.
  for (const r of page.rows) assert.equal(r.reach.num, r.answers, r.name);
});
