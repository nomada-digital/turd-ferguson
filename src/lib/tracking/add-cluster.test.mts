import assert from "node:assert/strict";
import { test } from "node:test";

import { keywordForm } from "../scan/dataforseo-request.ts";

import { addPanelState, checkVerdict, draftPrompts, isPluralHead, keywordHead, precheckKeyword, refuseDrafts, signCheck, verdictFromQuery, verdictQuery, verifyCheck } from "./add-cluster.ts";

// BRIEF-3 T6 part 3a (30 Sep 2026): the free checks that stand before any paid
// read, and C1's pick in the board's words. Made-up Tallyroo, as the fixture.

const P = { tracked: ["Invoicing Software"], brands: ["Tallyroo", "tallyroo.com"] };

test("each free refusal, before any read", () => {
  assert.equal((precheckKeyword("  invoicing   software ", P) as { reason: string }).reason, "tracked");
  assert.equal((precheckKeyword("tallyroo pricing", P) as { reason: string }).reason, "own_brand");
  assert.equal((precheckKeyword("what is bookkeeping", P) as { reason: string }).reason, "informational");
  assert.equal((precheckKeyword("bookkeeping course online", P) as { reason: string }).reason, "informational");
  assert.equal((precheckKeyword("payroll", P) as { reason: string }).reason, "too_broad");
  assert.deepEqual(precheckKeyword("Accounting Software for Dentists", P), { ok: true, keyword: "accounting software for dentists" });
});

test("a refusal offers 'Ask us to pick one' except when the keyword is already tracked", () => {
  assert.equal((precheckKeyword("invoicing software", P) as { ask: boolean }).ask, false);
  assert.equal((precheckKeyword("payroll", P) as { ask: boolean }).ask, true);
});

test("C1's pick becomes the board's verdict", () => {
  const ok = checkVerdict({ keyword: "accounting software for dentists", volume: 1300, intent: "commercial" }, "the United States");
  assert.deepEqual(ok, { ok: true, keyword: "accounting software for dentists", volume: 1300, intent: "commercial", message: "1,300 searches a month in the United States, commercial intent. Good to track." });
  assert.equal((checkVerdict({ none: "no_intent" }, "x") as { reason: string }).reason, "informational");
  assert.equal((checkVerdict({ none: "no_volume" }, "x") as { reason: string }).reason, "no_volume");
  assert.equal((checkVerdict("read_failed", "x") as { reason: string }).reason, "read_failed");
});

test("the panel is full at the limit", () => {
  assert.equal(addPanelState(9, 10), "open");
  assert.equal(addPanelState(10, 10), "full");
  assert.equal(addPanelState(12, 15), "open");
});

test("the verdict survives the 303 as codes, and URL text is never a message", () => {
  const where = "the United States";
  const pass = checkVerdict({ keyword: "accounting software for dentists", volume: 1300, intent: "commercial" }, where);
  const q = new URLSearchParams(verdictQuery(pass));
  assert.deepEqual(verdictFromQuery((k) => q.get(k), "accounting software for dentists", where), pass);
  const fail = new URLSearchParams(verdictQuery(checkVerdict({ none: "no_volume" }, where)));
  assert.equal(verdictFromQuery((k) => fail.get(k), "x y", where)?.message, checkVerdict({ none: "no_volume" }, where).message);
  const capped = new URLSearchParams({ ck: "capped" });
  assert.equal((verdictFromQuery((k) => capped.get(k), "x y", where) as { reason: string }).reason, "capped");
  for (const bad of [{ ck: "<b>hi</b>", vol: "", intent: "" },{ ck: "ok", vol: "-3", intent: "commercial" }, { ck: "ok", vol: "90", intent: "informational" }, { ck: "toString", vol: "", intent: "" }]) {
    const b = new URLSearchParams(bad);
    assert.equal(verdictFromQuery((k) => b.get(k), "x y", where), null, JSON.stringify(bad));
  }
});

test("step 2 drafts five distinct prompts that pass the text rule, and refuses twins", () => {
  const d = draftPrompts("Accounting Software  for Dentists");
  assert.equal(d.length, 5);
  assert.equal(d[0], "What’s the best accounting software for dentists?");
  assert.equal(refuseDrafts(d), null);
  // ON-1 review (9 Oct 2026): two the same among the five are their own refusal - nothing is tracked yet.
  assert.match(refuseDrafts([d[0], d[1], d[2], d[3], d[0].toUpperCase()]) ?? "", /Two of these prompts are the same/);
  assert.match(refuseDrafts([d[0], "short", d[2], d[3], d[4]]) ?? "", /characters/);
  assert.ok(refuseDrafts(d.slice(0, 4)));
});

test("R171: drafts agree with the keyword's head noun and fit a product or a service", () => {
  const cases: [string, string[]][] = [
    // singular product: the drafts as they were before R171
    ["accounting software for dentists", ["What’s the best accounting software for dentists?", "Which accounting software for dentists is easiest to set up and use?", "Which accounting software for dentists do small businesses recommend?", "Which accounting software for dentists saves the most time each month?", "What’s a good alternative to the best-known accounting software for dentists?"]],
    // plural product
    ["invoicing tools", ["What are the best invoicing tools?", "Which invoicing tools are easiest to set up and use?", "Which invoicing tools do small businesses recommend?", "Which invoicing tools save the most time each month?", "What are good alternatives to the best-known invoicing tools?"]],
    // plural service (the soak's own example)
    ["b2b seo agencies", ["Who are the best b2b seo agencies?", "Which b2b seo agencies are easiest to work with?", "Which b2b seo agencies do small businesses recommend?", "Which b2b seo agencies get results fastest?", "What are good alternatives to the best-known b2b seo agencies?"]],
    // singular service, local
    ["seo agency in london", ["Who is the best seo agency in london?", "Which seo agency in london is easiest to work with?", "Which seo agency in london do small businesses recommend?", "Which seo agency in london gets results fastest?", "What’s a good alternative to the best-known seo agency in london?"]],
    // plural service, local, with a leading "best" dropped
    ["Best plumbers near me", ["Who are the best plumbers near me?", "Which plumbers near me are easiest to work with?", "Which plumbers near me do small businesses recommend?", "Which plumbers near me get results fastest?", "What are good alternatives to the best-known plumbers near me?"]],
    // 4+ words, plural head before the preposition
    ["project management apps for remote design teams", ["What are the best project management apps for remote design teams?", "Which project management apps for remote design teams are easiest to set up and use?", "Which project management apps for remote design teams do small businesses recommend?", "Which project management apps for remote design teams save the most time each month?", "What are good alternatives to the best-known project management apps for remote design teams?"]],
  ];
  for (const [kw, want] of cases) {
    const d = draftPrompts(kw);
    assert.deepEqual(d, want, kw);
    assert.equal(refuseDrafts(d), null, kw);
    for (const p of d) {
      assert.doesNotMatch(p, /best best|best top/, `${kw}: said twice`);
      if (isPluralHead(keywordHead(keywordForm(kw).replace(/^best /, "")))) assert.doesNotMatch(p, / is | saves | gets |What’s the best|a good alternative/, `${kw}: singular verb on a plural head: ${p}`);
      else assert.doesNotMatch(p, / are | save | get |What are/, `${kw}: plural verb on a singular head: ${p}`);
    }
  }
  // Singular heads that end in s, and mass nouns.
  for (const w of ["business", "status", "analysis", "analytics", "software", "crm"]) assert.equal(isPluralHead(w), false, w);
  for (const w of ["agencies", "tools", "coaches", "boxes", "services", "consultants"]) assert.equal(isPluralHead(w), true, w);
  assert.equal(keywordHead("payroll software for small business"), "software");
  assert.equal(keywordHead("crm"), "crm");
});

test("a signed pass verifies for its client and day only, so the check cannot be skipped", () => {
  const p = { clientId: "c1", keyword: "accounting software for dentists", volume: 1300, intent: "commercial", day: "2026-09-30" };
  const sig = signCheck(p, "s3cret-for-test");
  assert.ok(verifyCheck(p, sig, "s3cret-for-test"));
  assert.ok(verifyCheck({ ...p, keyword: "Accounting Software for Dentists" }, sig, "s3cret-for-test"));
  for (const bad of [{ ...p, clientId: "c2" }, { ...p, volume: 99999 }, { ...p, intent: "transactional" }, { ...p, day: "2026-10-01" }]) assert.equal(verifyCheck(bad, sig, "s3cret-for-test"), false);
  assert.equal(verifyCheck(p, sig, ""), false);
  assert.equal(verifyCheck(p, null, "s3cret-for-test"), false);
});
