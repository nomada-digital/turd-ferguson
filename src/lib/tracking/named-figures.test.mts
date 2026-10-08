import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { type AnswerRow, brandBoard, comparisonRange, shareOfVoice } from "./figures.ts";
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

test("8 Oct 2026 (audit reliability-1 / data-6): Who is named reads the brands-unread fixture as if its unread answers were not there", () => {
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" });
  const unread = u.data.answers.filter((a) => a.brands_ok === false);
  assert.ok(unread.length >= 40, `the state marks ${unread.length} answers`);
  const without = u.data.answers.filter((a) => a.brands_ok !== false);
  assert.deepEqual(namedPage({ answers: u.data.answers, range, before, you }), namedPage({ answers: without, range, before, you }));
  assert.deepEqual(shareOfVoice(u.data.answers, range), shareOfVoice(without, range));
  const key = namedPage({ answers: without, range, before, you }).rows[1]!.key;
  for (const k of [key, "tallyroo"]) {
    assert.deepEqual(
      citedWithBrand({ answers: u.data.answers, range, key: k, you, domain: fx.client.domain }),
      citedWithBrand({ answers: without, range, key: k, you, domain: fx.client.domain }),
      k,
    );
  }
  // As the runner stored it before 8 Oct - brands [] with nothing to say so - today's share was the client's to gain.
  const today = { from: fx.today, to: fx.today };
  const asBefore = u.data.answers.map((a) => (a.brands_ok === false ? { ...a, brands_ok: true } : a));
  assert.ok(shareOfVoice(asBefore, today).pct! > shareOfVoice(u.data.answers, today).pct!, "the old storage inflates the share");
  assert.ok(brandBoard(asBefore, today, null, you).find((b) => b.you)!.share.pct! > brandBoard(u.data.answers, today, null, you).find((b) => b.you)!.share.pct!);
});
