import assert from "node:assert/strict";
import { test } from "node:test";

import type { ClusterCard, ClusterPrompt } from "./cluster-figures.ts";
import { neverNamedFacts, offPageOneFacts } from "./upgrade-facts.ts";
import { pickPrompt, promptCopy } from "./upgrade-prompts.ts";

const r = (num: number, den: number) => ({ num, den, pct: den ? Math.round((100 * num) / den) : null });
const prompt = (id: string, num: number, den: number, stoppedOn: string | null = null): ClusterPrompt => ({ id, text: id, angle: null, now: r(num, den), before: null, namedBy: [], daysChecked: 0, daysNamed: [], stoppedOn, fixed: den > 0 , pending: false});
const card = (id: string, over: Partial<ClusterCard>): ClusterCard => ({
  id,
  name: id,
  keywordId: `k-${id}`,
  keyword: id,
  volume: null,
  intent: null,
  status: "live",
  stoppedOn: null,
  started_on: "2026-08-01",
  now: r(0, 0),
  before: null,
  delta: null,
  promptsNamed: r(0, 0),
  position: null,
  positionRead: true,
  positionBefore: null,
  positionChange: null,
  positionEvent: null,
  prompts: [],
  heat: [],
  ...over,
});

const range = { from: "2026-09-03", to: "2026-09-30" };
const cite = (...hosts: string[]) => hosts.map((h) => ({ source_domain: h, url: null }));

test("never named: prompts read with no named answer, of the prompts read, their answers and top two cited hosts", () => {
  const cards = [
    card("a", { prompts: [prompt("a1", 0, 20), prompt("a2", 4, 20), prompt("a3", 0, 16), prompt("a4", 0, 0)] }),
    card("b", { prompts: [prompt("b1", 0, 12), prompt("b2", 0, 12, "2026-09-20")] }),
    card("p", { status: "pending", prompts: [prompt("p1", 0, 3)] }),
    card("s", { stoppedOn: "2026-09-10", prompts: [prompt("s1", 0, 8)] }),
  ];
  const answers = [
    { question_id: "a1", run_date: "2026-09-10", answered: true, citations: cite("www.thesmallbizstack.com", "softwarecritic.com", "tallyroo.com") },
    { question_id: "a3", run_date: "2026-09-11", answered: true, citations: cite("thesmallbizstack.com", "thesmallbizstack.com") },
    { question_id: "b1", run_date: "2026-09-12", answered: true, citations: cite("softwarecritic.com", "ledgerline.com", "tallyroo.com") },
    { question_id: "b1", run_date: "2026-09-13", answered: true, citations: cite("ledgerline.com") },
    { question_id: "b1", run_date: "2026-09-14", answered: true, citations: cite("ledgerline.com") },
    // Named prompt, out of range, unanswered: none count.
    { question_id: "a2", run_date: "2026-09-12", answered: true, citations: cite("ledgerline.com") },
    { question_id: "a1", run_date: "2026-09-02", answered: true, citations: cite("ledgerline.com") },
    { question_id: "a1", run_date: "2026-09-15", answered: false, citations: cite("ledgerline.com") },
  ];
  assert.deepEqual(neverNamedFacts({ cards, answers, range, domain: "tallyroo.com" }), {
    prompts: 3,
    of: 4,
    answers: 48,
    // Counted once per answer: ledgerline 3, softwarecritic 2, thesmallbizstack 2 (a tie goes alphabetically).
    hosts: ["ledgerline.com", "softwarecritic.com"],
    // What "Ask about these 3" sends: the never-named prompts, in card order.
    ids: ["a1", "a3", "b1"],
  });
});

test("off page 1: cluster keywords whose latest reading is #11 to #20, of the keywords read", () => {
  const cards = [
    card("a", { position: 11 }),
    card("b", { position: 14 }),
    card("c", { position: 21 }),
    card("d", { position: 3 }),
    card("e", { position: null }),
    card("f", { keyword: null, position: null }),
    card("g", { position: 12, stoppedOn: "2026-09-20" }),
  ];
  // ids: what "Ask about these 2" sends - the off-page-1 keywords, in card order.
  // of: 5 since DS51 (2 Oct 2026) - "e", read with no rank, counts as the overview's page-1 figure counts it.
  assert.deepEqual(offPageOneFacts(cards), { keywords: 2, of: 5, best: 11, worst: 14, ids: ["k-a", "k-b"] });
  assert.deepEqual(offPageOneFacts([card("x", { position: 30 })]), { keywords: 0, of: 1, best: 0, worst: 0, ids: [] });
});

test("the facts feed the rules: a tracked client with 3 never-named prompts is offered alwaysmentioned", () => {
  const cards = [card("a", { prompts: [prompt("a1", 0, 20), prompt("a2", 0, 20), prompt("a3", 0, 20), prompt("a4", 5, 20)], position: 4 })];
  const facts = {
    tier: "tracked" as const,
    mode: "nomada" as const,
    state: "ok" as const,
    startedOn: "2026-08-01",
    today: "2026-09-30",
    hidden: new Set<never>(),
    neverNamed: neverNamedFacts({ cards, answers: [], range, domain: "tallyroo.com" }),
    offPageOne: offPageOneFacts(cards),
  };
  assert.equal(pickPrompt(facts), "mentioned");
  const c = promptCopy("mentioned", facts)!;
  assert.equal(c.title, "3 prompts never name you");
  // No cited host read: the "pages like" sentence is left out rather than invented.
  assert.ok(c.lead.startsWith("Getting placed on the pages they cite"));
  assert.equal(c.why, "Shown because 3 of your 4 prompts named you in none of their 60 answers this period.");
});
