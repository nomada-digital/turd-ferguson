import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { FIXTURE_STATES, expandFixture, fixtureLive, fixtureMode, fixtureState, fixtureUnreadable } from "./fixture-mode.ts";
import { addDays, overview } from "./figures.ts";
import { ANGLES, PROMPTS_PER_CLUSTER, namesBrandIn } from "./limits.ts";

/**
 * R93 / BRIEF-2 T9 (29 Sep 2026): the fixture switch, and the fixture itself.
 * The fixture is made up - Tallyroo from boards-3/dataset.py - and is never
 * served in production.
 */

test("TRACKING_FIXTURE=1 is refused when VERCEL_ENV=production", () => {
  assert.throws(() => fixtureMode({ TRACKING_FIXTURE: "1", VERCEL_ENV: "production" }), /refuses/);
});

test("the fixture switch is off unless TRACKING_FIXTURE is exactly 1, and on outside production", () => {
  assert.equal(fixtureMode({}), false);
  assert.equal(fixtureMode({ VERCEL_ENV: "production" }), false);
  assert.equal(fixtureMode({ TRACKING_FIXTURE: "true" }), false);
  assert.equal(fixtureMode({ TRACKING_FIXTURE: "1" }), true);
  assert.equal(fixtureMode({ TRACKING_FIXTURE: "1", VERCEL_ENV: "preview" }), true);
});

test("the /app layout asks the switch on every request", () => {
  const layout = readFileSync(new URL("../../app/app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /^\s*fixtureMode\(\);/m);
});

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));

test("the fixture expands to the rows the overview reads, and the overview computes on it", () => {
  assert.equal(fx.client.brand, "Tallyroo");
  assert.equal(fx.data.questions.length, 50, "10 clusters of 5 prompts");
  assert.equal(fx.data.keywords.length, 10);
  assert.ok(fx.data.answers.length > 5000, "both periods of daily answers");
  assert.ok(fx.data.answers.every((a) => a.answered && typeof a.named === "boolean"));
  assert.ok(fx.data.answers.some((a) => a.citations.length), "cited pages carried");
  const o = overview({
    range: { from: "2026-09-02", to: fx.today },
    compare: "prev",
    startedOn: fx.client.started_on,
    engines: ["google_aio", "chatgpt", "gemini", "perplexity"],
    questions: fx.data.questions,
    answers: fx.data.answers,
    serp: fx.data.serp,
    keywordCount: fx.data.keywords.length,
  });
  assert.ok(o.named.den > 0 && o.named.num > 0 && o.named.num < o.named.den);
});

test("the fixture is cluster-shaped: 10 clusters, each one keyword and one prompt per angle (R117 T9 step, 30 Sep 2026)", () => {
  const { clusters, questions, keywords } = fx.data;
  assert.equal(clusters.length, fx.client.cluster_limit);
  assert.deepEqual(new Set(clusters.map((c) => c.keyword_id)).size, clusters.length, "one live cluster per keyword");
  for (const c of clusters) {
    const kw = keywords.find((k) => k.id === c.keyword_id);
    assert.ok(kw, `${c.id} joins to a keyword row`);
    assert.equal(c.name, kw.keyword, "a cluster is named for its keyword");
    assert.ok(kw.search_volume && kw.search_volume > 0);
    assert.ok(kw.intent === "commercial" || kw.intent === "transactional");
    const prompts = questions.filter((q) => q.cluster_id === c.id);
    assert.deepEqual(prompts.map((q) => q.angle), [...ANGLES], `${c.id} has one prompt per angle, in order`);
    assert.ok(prompts.every((q) => q.added_on === c.started_on));
  }
  assert.ok(questions.every((q) => q.cluster_id !== null), "no ungrouped prompt in the fixture");
  const pending = clusters.filter((c) => c.started_on > fx.today);
  assert.equal(pending.length, 1, "one pending cluster, first asked tomorrow");
  const pendingIds = new Set(questions.filter((q) => q.cluster_id === pending[0].id).map((q) => q.id));
  assert.ok(!fx.data.answers.some((a) => pendingIds.has(a.question_id)), "a pending cluster has no readings");
});

test("the fixture names only the made-up brands and domains", () => {
  const brands = new Set(fx.data.answers.flatMap((a) => a.brands));
  // R143 (1 Oct 2026): Tallyroo is the client, so as the runner writes rows it
  // is never among the other brands; expandFixture drops it from them.
  assert.deepEqual([...brands].sort(), ["Brightbook", "Countwise", "Ledgerline", "Sumly"]);
  assert.equal(fx.client.domain, "tallyroo.com");
  assert.match(fx.member.email, /@example\.com$/);
});

test("R138: TRACKING_FIXTURE_STATE=ungrouped serves the client with no clusters and no prompt in one; unset changes nothing", () => {
  assert.equal(fixtureState(fx, {}), fx);
  assert.equal(fixtureState(fx, { TRACKING_FIXTURE_STATE: "other" }), fx);
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "ungrouped" });
  assert.equal(u.data.clusters.length, 0);
  assert.equal(u.data.questions.length, fx.data.questions.length);
  assert.ok(u.data.questions.every((q) => q.cluster_id === null));
  assert.equal(u.placements.length, 0);
  assert.ok(fx.data.questions.some((q) => q.cluster_id), "the default fixture is untouched");
});

test("R148 pass 7: TRACKING_FIXTURE_STATE=new is day zero - everything live starts tomorrow, nothing read yet", () => {
  const n = fixtureState(fx, { TRACKING_FIXTURE_STATE: "new" });
  const tomorrow = addDays(fx.today, 1);
  assert.equal(n.client.started_on, tomorrow);
  assert.ok(n.data.clusters.length > 0 && n.data.clusters.every((c) => c.started_on === tomorrow && c.stopped_on === null));
  assert.ok(n.data.questions.length > 0 && n.data.questions.every((q) => q.added_on === tomorrow && q.stopped_on === null));
  assert.ok(n.data.keywords.every((k) => k.added_on === tomorrow && k.stopped_on === null));
  assert.deepEqual([n.data.answers.length, n.data.serp.length, n.data.notes.length, n.placements.length, n.clusterNotes.length], [0, 0, 0, 0, 0]);
  assert.equal(n.data.lastRun, null);
  assert.ok(fx.data.answers.length > 0, "the default fixture is untouched");
});

test("R148 pass 10: TRACKING_FIXTURE_STATE=signup is day zero as signup.ts builds it from a scan with no keyword", () => {
  const s = fixtureState(fx, { TRACKING_FIXTURE_STATE: "signup" });
  const src = readFileSync(new URL("../checkout/signup.ts", import.meta.url), "utf8");
  const name = src.match(/export const NEEDS_A_KEYWORD = "([^"]+)"/)?.[1];
  assert.ok(name, "signup.ts still exports NEEDS_A_KEYWORD");
  assert.deepEqual(s.data.clusters.map((c) => [c.name, c.keyword_id]), [[name, null]]);
  assert.equal(s.data.questions.length, PROMPTS_PER_CLUSTER);
  assert.ok(s.data.questions.every((q) => q.cluster_id === s.data.clusters[0]!.id));
  assert.deepEqual([s.data.keywords.length, s.data.answers.length, s.data.serp.length], [0, 0, 0]);
  assert.equal(s.client.started_on, addDays(fx.today, 1));
});

test("R151: TRACKING_FIXTURE_STATE=partial is today's run with every Google AI Overview read failed", () => {
  const p = fixtureState(fx, { TRACKING_FIXTURE_STATE: "partial" });
  assert.deepEqual(p.data.lastRun, { run_date: fx.today, status: "partial", finished_at: `${fx.today}T06:10:00Z` });
  const today = p.data.answers.filter((a) => a.run_date === fx.today);
  const aio = today.filter((a) => a.engine === "google_aio");
  assert.ok(aio.length > 0 && aio.every((a) => !a.answered && !a.named && !a.brands.length && !a.citations.length));
  assert.ok(today.filter((a) => a.engine !== "google_aio").every((a) => a.answered), "the other engines landed");
  assert.ok(p.data.answers.filter((a) => a.run_date < fx.today).every((a) => a.answered), "earlier days untouched");
  assert.ok(!Object.keys(p.texts).some((k) => k.endsWith(" google_aio")), "no answer text for a read that failed");
  assert.equal(p.data.answers.length, fx.data.answers.length);
});

test("R151: TRACKING_FIXTURE_STATE=failed is a run where no read landed - nothing answered today, last check the day before", () => {
  const f = fixtureState(fx, { TRACKING_FIXTURE_STATE: "failed" });
  assert.equal(f.data.lastRun?.run_date, addDays(fx.today, -1));
  assert.equal(f.data.lastRun?.status, "complete");
  const today = f.data.answers.filter((a) => a.run_date === fx.today);
  assert.ok(today.length > 0 && today.every((a) => !a.answered && !a.named));
  assert.deepEqual(f.texts, {});
  assert.ok(fx.data.answers.filter((a) => a.run_date === fx.today).every((a) => a.answered), "the default fixture is untouched");
});

test("R151: TRACKING_FIXTURE_STATE=stopped is one prompt in the first cluster stopped today, read today, gone tomorrow", () => {
  const s = fixtureState(fx, { TRACKING_FIXTURE_STATE: "stopped" });
  const first = fx.data.clusters[0]!.id;
  const changed = s.data.questions.filter((q, i) => q !== fx.data.questions[i]);
  assert.equal(changed.length, 1, "exactly one prompt moves");
  assert.equal(changed[0]!.cluster_id, first);
  assert.equal(changed[0]!.stopped_on, addDays(fx.today, 1));
  assert.equal(s.data.questions.filter((q) => q.cluster_id === first && q.stopped_on === null).length, PROMPTS_PER_CLUSTER - 1, "its slot is free");
  assert.ok(fx.data.questions.every((q) => q.stopped_on === null), "the default fixture is untouched");
});

test("R146: TRACKING_FIXTURE_ROLE signs the fixture in as each member; removed is refused, a typo throws", () => {
  assert.equal(fixtureState(fx, {}).member.role, "owner");
  assert.ok(fixtureLive(fx, fx.member.email), "the default session is a live member");
  for (const role of ["editor", "viewer"] as const) {
    const f = fixtureState(fx, { TRACKING_FIXTURE_ROLE: role });
    assert.equal(f.member.role, role);
    assert.notEqual(f.member.email, fx.member.email);
    assert.ok(fixtureLive(f, f.member.email), `${role} sees the client`);
  }
  const gone = fixtureState(fx, { TRACKING_FIXTURE_ROLE: "removed" });
  assert.ok(fx.members.some((m) => m.email === gone.member.email && m.removed_at), "removed signs in as the removed member");
  assert.equal(fixtureLive(gone, gone.member.email), false, "a removed member is not live, so every client page 404s");
  assert.equal(fixtureLive(fx, "stranger@example.com"), false);
  assert.throws(() => fixtureState(fx, { TRACKING_FIXTURE_ROLE: "admin" }), /no such member/);
  const both = fixtureState(fx, { TRACKING_FIXTURE_ROLE: "viewer", TRACKING_FIXTURE_STATE: "ungrouped" });
  assert.equal(both.member.role, "viewer");
  assert.equal(both.data.clusters.length, 0);
});

test("R151: TRACKING_FIXTURE_STATE=unreadable throws the overview read, as a refused Supabase read does; nothing else does", () => {
  assert.throws(() => fixtureUnreadable({ TRACKING_FIXTURE_STATE: "unreadable" }), /could not read the runs/);
  for (const state of [undefined, "new", "partial", "failed", "ungrouped"]) assert.doesNotThrow(() => fixtureUnreadable({ TRACKING_FIXTURE_STATE: state }));
});

test("R169: TRACKING_FIXTURE_STATE=pilot-mixed is one pending cluster and five live ungrouped prompts, four naming the brand", () => {
  assert.ok(FIXTURE_STATES.includes("pilot-mixed"));
  const m = fixtureState(fx, { TRACKING_FIXTURE_STATE: "pilot-mixed" });
  const tomorrow = addDays(fx.today, 1);
  assert.equal(m.data.clusters.length, 1);
  const c = m.data.clusters[0]!;
  assert.equal(c.started_on, tomorrow, "pending: starts tomorrow");
  const drafted = m.data.questions.filter((q) => q.cluster_id === c.id);
  assert.equal(drafted.length, PROMPTS_PER_CLUSTER);
  assert.ok(drafted.every((q) => q.added_on === tomorrow && q.stopped_on === null));
  assert.ok(!m.data.answers.some((a) => drafted.some((q) => q.id === a.question_id)), "no readings on the pending cluster");
  assert.deepEqual(m.data.keywords.map((k) => [k.id, k.added_on]), [[c.keyword_id, tomorrow]]);
  const ungrouped = m.data.questions.filter((q) => q.cluster_id === null);
  assert.equal(ungrouped.length, 5);
  assert.ok(ungrouped.every((q) => q.stopped_on === null && q.added_on <= fx.today), "live and already read");
  const subject = { brand: m.client.brand, domain: m.client.domain, aliases: m.aliases };
  assert.equal(ungrouped.filter((q) => namesBrandIn(q.text, subject)).length, 4);
  for (const q of ungrouped) assert.ok(m.data.answers.some((a) => a.question_id === q.id && a.run_date === fx.today), `${q.id} read today`);
  const branded = new Set(ungrouped.filter((q) => namesBrandIn(q.text, subject)).map((q) => q.id));
  assert.ok(m.data.answers.filter((a) => branded.has(a.question_id) && a.answered).every((a) => a.named));
  assert.deepEqual([m.placements, m.clusterNotes, m.data.serp, m.data.notes], [[], [], [], []]);
  assert.ok(Object.keys(m.texts).every((k) => !branded.has(k.split(" ")[0]!)), "no answer text that predates the branded wording");
});

test("DS19: TRACKING_FIXTURE_STATE=uncited keeps every reading and cites no page", () => {
  assert.ok(FIXTURE_STATES.includes("uncited"));
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "uncited" });
  assert.ok(fx.data.answers.some((a) => a.citations.length > 0), "the default cites pages");
  assert.ok(u.data.answers.every((a) => a.citations.length === 0));
  assert.deepEqual(u.data.answers.map((a) => [a.question_id, a.engine, a.run_date, a.named]), fx.data.answers.map((a) => [a.question_id, a.engine, a.run_date, a.named]));
});

test("DS44: TRACKING_FIXTURE_STATE=long keeps every reading and puts rivals, cited pages and placements past ten", () => {
  assert.ok(FIXTURE_STATES.includes("long"));
  const l = fixtureState(fx, { TRACKING_FIXTURE_STATE: "long" });
  const key = (f: typeof fx) => f.data.answers.map((a) => [a.question_id, a.engine, a.run_date, a.named, a.answered]);
  assert.deepEqual(key(l), key(fx));
  const brands = new Set(l.data.answers.flatMap((a) => a.brands));
  const pages = new Set(l.data.answers.flatMap((a) => a.citations.map((c) => c.url)));
  assert.ok(brands.size > 10 && pages.size > 10 && l.placements.length > 10, `${brands.size} brands, ${pages.size} pages, ${l.placements.length} placements`);
  assert.ok(l.placements.every((p) => p.cluster_id === "c1"));
});

test("8 Oct 2026: the trial states carry a trial end in real time, a cancel, or an ended status", () => {
  for (const st of ["trial", "trial-ending", "trial-cancelled", "ended"] as const) assert.ok(FIXTURE_STATES.includes(st), st);
  const now = Date.now();
  const t = fixtureState(fx, { TRACKING_FIXTURE_STATE: "trial" });
  const days = (iso: string | null | undefined) => (Date.parse(iso ?? "") - now) / 86_400_000;
  assert.ok(Math.abs(days(t.client.trial_ends_at) - 9) < 0.01);
  assert.equal(t.client.trial_cancelled_at, null);
  assert.ok(Math.abs(days(fixtureState(fx, { TRACKING_FIXTURE_STATE: "trial-ending" }).client.trial_ends_at) - 2) < 0.01);
  assert.ok(days(fixtureState(fx, { TRACKING_FIXTURE_STATE: "trial-cancelled" }).client.trial_cancelled_at) < 0);
  const e = fixtureState(fx, { TRACKING_FIXTURE_STATE: "ended" });
  assert.equal(e.client.status, "ended");
  assert.equal(fx.client.status, undefined, "the default client carries no status, as before");
});
