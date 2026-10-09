import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { draftPrompts, refuseDrafts } from "./add-cluster.ts";
import { ADMIN_LIMITS } from "./decide.ts";
import { addDays } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";
import { FIXTURE_CHECK_VOLUME, fixtureCheck, fixtureFillDrafts, fixtureRekey } from "./fixture-writes.ts";
import { ANGLES } from "./limits.ts";
import { fillDrafts } from "./new-cluster.ts";
import { KEYWORD_FIXED, refuseRekey } from "./rekey.ts";
import { draftField, draftsFor, draftsLine, draftsReturn, readDrafts } from "./setup-drafts.ts";
import { SLOT_WHY, slotWhyOf } from "./slot.ts";

/**
 * ON-1 (9 Oct 2026, launch blocker LB8): a trial bought with no scan gets a
 * "Needs a keyword" cluster with no prompts, and the runner skips a client
 * with no live prompt. The setup card now drafts five prompts from the
 * keyword, and Save writes them through the free slot's write. These hold the
 * card's rules, the route's reading of the form and its way back, the write's
 * refusals and rows, and the keyword a keywordless cluster can now be given.
 */

const KW = "invoicing app for freelancers";

test("only a cluster with a keyword and no prompt is offered drafts, and they are draftPrompts' five", () => {
  assert.deepEqual(draftsFor({ keyword: KW, prompts: [] }), draftPrompts(KW));
  assert.equal(draftsFor({ keyword: KW, prompts: [{ id: "q1" }] }), null, "a cluster with prompts keeps them");
  assert.equal(draftsFor({ keyword: null, prompts: [] }), null, "no keyword, nothing to draft from");
  assert.equal(draftPrompts(KW).length, ANGLES.length);
  assert.equal(refuseDrafts(draftPrompts(KW)), null, "the drafts pass their own rule as drafted");
});

test("the posted drafts are read as five, a missing one as empty, an over-long one still refused", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  assert.equal(readDrafts(form({ text: "Which app is best for a sole trader?" })), null, "the free slot's one text is not drafts");
  const five = Object.fromEntries(draftPrompts(KW).map((t, i) => [draftField(i), t]));
  assert.deepEqual(readDrafts(form(five)), draftPrompts(KW));
  const four = readDrafts(form({ ...five, [draftField(4)]: undefined as unknown as string }))!;
  assert.equal(four[4], "");
  assert.ok(refuseDrafts(four), "a missing draft is refused by the drafts' rule");
  const long = readDrafts(form({ ...five, [draftField(2)]: "x".repeat(ADMIN_LIMITS.question * 3) }))!;
  assert.equal(long[2]!.length, ADMIN_LIMITS.question + 1);
  assert.ok(refuseDrafts(long), "cut one past the limit, so it is refused rather than trimmed into a pass");
});

test("the way back to the setup card, and the line it draws from fixed words only", () => {
  assert.equal(draftsReturn("acme", "c1", true), "/app/acme/setup?card=c1&drafts=saved#card-c1");
  assert.equal(draftsReturn("acme", "c1", false, "duplicate"), "/app/acme/setup?card=c1&drafts=refused&why=duplicate", "a refusal keeps no fragment, so the field can take focus");
  assert.equal(draftsReturn("acme", "c1", false), "/app/acme/setup?card=c1&drafts=refused");
  assert.deepEqual(draftsLine("saved", null, "tomorrow at 06:00 UK time"), { ok: true, text: "Saved. They are first asked tomorrow at 06:00 UK time." });
  assert.deepEqual(draftsLine("refused", "duplicate", "x"), { ok: false, text: SLOT_WHY.duplicate });
  assert.match(draftsLine("refused", "<script>", "x")!.text, /did not save/, "an unknown code is never echoed");
  assert.equal(draftsLine(null, null, "x"), null);
  assert.equal(draftsLine("anything", null, "x"), null);
});

// ---- the write ----

const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } }) as unknown as SupabaseClient;
const base = { clientId: "c", clusterId: "k", prompts: draftPrompts(KW), today: "2026-10-09", by: "owner@example.com", role: "owner" };

test("a viewer, a twin and a short draft are refused before any read or write", async () => {
  assert.match(((await fillDrafts(untouchable, { ...base, role: "viewer" })) as { message: string }).message, /owners and editors/i);
  const twin = await fillDrafts(untouchable, { ...base, prompts: [...base.prompts.slice(0, 4), base.prompts[0]!.toUpperCase()] });
  assert.equal(slotWhyOf((twin as { message: string }).message), "duplicate");
  const short = await fillDrafts(untouchable, { ...base, prompts: ["short", ...base.prompts.slice(1)] });
  assert.equal(slotWhyOf((short as { message: string }).message), "length");
  assert.equal((await fillDrafts(untouchable, { ...base, prompts: base.prompts.slice(0, 4) })).ok, false, "five, not four");
});

/** Just the calls fillDrafts makes: the cluster, its live prompts, the room (insertPrompts) and the insert. */
function stand(p: { stopped: string | null; live: string[]; clientLive: number }) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      let head = false;
      let rows: Record<string, unknown>[] | null = null;
      const b = {
        select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), b),
        eq: () => b,
        is: () => b,
        single: () => b,
        maybeSingle: () => b,
        insert: (r: Record<string, unknown>[]) => ((rows = r), inserted.push(...r), b),
        then(ok: (v: unknown) => unknown) {
          if (rows) return Promise.resolve(ok({ data: rows.map((_, i) => ({ id: `new-${i}` })), error: null }));
          if (table === "tracked_clusters") return Promise.resolve(ok({ data: { stopped_on: p.stopped }, error: null }));
          if (table === "client_domains") return Promise.resolve(ok({ data: { cluster_limit: 10 }, error: null }));
          if (head) return Promise.resolve(ok({ count: table === "tracked_questions" ? p.clientLive : 0, error: null }));
          return Promise.resolve(ok({ data: p.live.map((text) => ({ text })), error: null }));
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, inserted };
}

test("five drafts are written as the free slot writes a prompt: one per angle, from tomorrow, the member's own", async () => {
  const { db, inserted } = stand({ stopped: null, live: [], clientLive: 0 });
  const r = await fillDrafts(db, base);
  assert.deepEqual(r, { ok: true, ids: ["new-0", "new-1", "new-2", "new-3", "new-4"] });
  assert.deepEqual(
    inserted.map((q) => [q.text, q.angle, q.added_on, q.source, q.added_by, q.cluster_id]),
    draftPrompts(KW).map((t, i) => [t, ANGLES[i], addDays(base.today, 1), "client", "owner@example.com", "k"]),
  );
});

test("a stopped cluster, or one that already has live prompts, takes none of them", async () => {
  const stopped = stand({ stopped: "2026-10-08", live: [], clientLive: 0 });
  assert.match(((await fillDrafts(stopped.db, base)) as { message: string }).message, /is stopped/);
  assert.equal(stopped.inserted.length, 0);
  // The room is read per cluster (liveCount on cluster_id) - two live, five more would pass five.
  const full = stand({ stopped: null, live: ["Which app is best for a sole trader?", "Who makes the simplest invoicing app?"], clientLive: 2 });
  const r = await fillDrafts(full.db, base);
  assert.equal(r.ok, false);
  assert.equal(slotWhyOf((r as { message: string }).message), "full");
  assert.equal(full.inserted.length, 0);
});

// ---- the keyword a keywordless cluster is given, then its drafts, on the fixture ----

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));

test("a cluster that never had a keyword may be given its first at any time; a keyword it has stays fixed", () => {
  const today = "2026-10-09";
  const started = { started_on: "2026-10-05", stopped_on: null };
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: false, keywordless: true }), null);
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: false }), KEYWORD_FIXED, "R179 unchanged for a keyword it has");
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 3, taken: false, keywordless: false }), KEYWORD_FIXED);
  assert.match(refuseRekey({ role: "viewer", cluster: started, today, readings: 0, taken: false, keywordless: true })!, /owners and editors/i);
  assert.equal(refuseRekey({ role: "owner", cluster: started, today, readings: 0, taken: true, keywordless: true }), "You already track this keyword.");
});

test("on the fixture, a no-scan signup checks its keyword, sets it days after its start, and saves the five drafts", () => {
  // signup-typed is day zero; move it on three days, as a buyer who comes back to setup later.
  const s0 = fixtureState(fx, { TRACKING_FIXTURE_STATE: "signup-typed" });
  const today = addDays(s0.today, 3);
  const s = { ...s0, today };
  const card = s.data.clusters[0]!;
  assert.equal(card.keyword_id, null);
  assert.equal(s.data.questions.length, 0);
  assert.ok(card.started_on <= today, "the cluster has started");
  const { check, sig } = fixtureCheck(s, KW);
  assert.ok(check.ok && sig);
  const keyed = fixtureRekey(s, { clusterId: card.id, keyword: KW, volume: FIXTURE_CHECK_VOLUME, intent: check.ok ? check.intent : "", sig: sig ?? null, role: "owner" });
  assert.ok(keyed.ok, keyed.ok ? "" : keyed.message);
  const kw = keyed.fixture.data.keywords.find((k) => k.keyword === KW)!;
  assert.equal(kw.added_on, addDays(today, 1), "checked from the next daily check, not back-dated to the start");
  const saved = fixtureFillDrafts(keyed.fixture, { clusterId: card.id, prompts: draftPrompts(KW), today, role: "owner" });
  assert.ok(saved.ok, saved.ok ? "" : saved.message);
  const mine = saved.fixture.data.questions.filter((q) => q.cluster_id === card.id);
  assert.deepEqual(mine.map((q) => [q.angle, q.added_on]), ANGLES.map((a) => [a, addDays(today, 1)]));
  // A second save finds no room: the cluster has its five.
  const again = fixtureFillDrafts(saved.fixture, { clusterId: card.id, prompts: draftPrompts("invoicing software for freelancers"), today, role: "owner" });
  assert.equal(again.ok, false);
  assert.equal(slotWhyOf((again as { message: string }).message), "full");
  // A viewer saves nothing.
  assert.equal(fixtureFillDrafts(keyed.fixture, { clusterId: card.id, prompts: draftPrompts(KW), today, role: "viewer" }).ok, false);
});

test("census: the setup card and the empty Clusters row post drafts to the free slot's route, which writes them with fillDrafts", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const route = src("../../app/api/app/[client]/prompt/route.ts");
  assert.match(route, /const drafts = readDrafts\(/, "the prompt route reads the drafts");
  assert.match(route, /await fillDrafts\(supabaseAdmin\(\), \{ clientId: client\.id, clusterId: f\.id, prompts: drafts, today: trackingDay\(\), by: email, role: writeRole\(client\) \}\)/, "and writes them through fillDrafts, as the member's role on a live client");
  const draft = src("./new-cluster.ts");
  assert.match(draft, /return fillSlots\(db, \{/, "fillDrafts is the free slot's write, not a fork of it");
  const setup = src("../../app/app/[client]/setup/page.tsx");
  assert.match(setup, /action=\{`\/api\/app\/\$\{encodeURIComponent\(slug\)\}\/prompt\?\$\{new URLSearchParams\(\{ kind: "cluster", id: c\.id, to: "setup" \}\)\}`\}/);
  assert.match(setup, /drafts && canWrite \? \(/, "owners and editors only; an ended client's writeRole is viewer");
  const clusters = src("../../components/app/Clusters.tsx");
  assert.equal((clusters.match(/<DraftPrompts /g) ?? []).length, 2, "the pending editor and the open row");
  assert.match(clusters, /act && bare && c\.keyword \? \(/, "the open row offers them to owners and editors only");
});
