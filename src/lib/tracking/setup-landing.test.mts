import assert from "node:assert/strict";
import { test } from "node:test";

import { SETUP_PROMPTS, SETUP_SINCE, confirmLabel, landingAfterAuth, needsSetup, setupCards, setupConfirmed, setupOutstanding, setupPath, setupState } from "./setup-landing.ts";

test("DS10: the Overview says setup is outstanding only for an unconfirmed client that needs it", () => {
  assert.equal(setupOutstanding({ started_on: "2026-10-03" }, false), true);
  assert.equal(setupOutstanding({ started_on: "2026-10-03" }, true), false);
  assert.equal(setupOutstanding({ started_on: "2026-10-03" }, null), false);
  assert.equal(setupOutstanding({ started_on: "2026-09-20" }, false), false);
  assert.equal(setupOutstanding({ started_on: "2026-09-30" }, false, true), true);
  assert.equal(setupOutstanding({ started_on: "2026-09-30" }, null, true), false);
});

test("only clients started since the setup page went live need setup", () => {
  assert.equal(SETUP_SINCE, "2026-10-02");
  assert.equal(needsSetup({ started_on: "2026-09-20" }), false);
  assert.equal(needsSetup({ started_on: "2026-10-01" }), false);
  assert.equal(needsSetup({ started_on: "2026-10-02" }), true);
  assert.equal(needsSetup({ started_on: null }), false);
});

test("setup is confirmed by a setup_confirmed event and nothing else", () => {
  assert.equal(setupConfirmed([]), false);
  assert.equal(setupConfirmed([{ event: "page_view" }, { event: "setup_reminder" }]), false);
  assert.equal(setupConfirmed([{ event: "page_view" }, { event: "setup_confirmed" }]), true);
});

test("an unconfirmed first client lands on its setup page, next or not", () => {
  const clients = [{ slug: "acme", confirmed: false }];
  assert.equal(landingAfterAuth({ next: null, clients }), "/app/acme/setup");
  assert.equal(landingAfterAuth({ next: "/app/acme/clusters", clients }), "/app/acme/setup");
  assert.equal(setupPath("acme"), "/app/acme/setup");
});

test("a confirmed client keeps the R163/R164 landing", () => {
  const clients = [{ slug: "acme", confirmed: true }, { slug: "beta", confirmed: false }];
  assert.equal(landingAfterAuth({ next: null, clients }), "/app/acme");
  assert.equal(landingAfterAuth({ next: "/app/acme/clusters", clients }), "/app/acme/clusters");
});

test("no clients, or a failed read, answer as today", () => {
  assert.equal(landingAfterAuth({ next: null, clients: [] }), "/app/login?access=none");
  assert.equal(landingAfterAuth({ next: null, clients: null }), "/app");
  assert.equal(landingAfterAuth({ next: "/app/acme/named", clients: null }), "/app/acme/named");
});

test("setup cards: one per live cluster, its keyword or null, five live prompts at most", () => {
  const cards = setupCards({
    clusters: [
      { id: "c1", name: "crm software", keyword_id: "k1", stopped_on: null },
      { id: "c2", name: "Needs a keyword", keyword_id: null, stopped_on: null },
      { id: "c3", name: "gone", keyword_id: null, stopped_on: "2026-09-30" },
    ],
    questions: [
      ...Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, text: `p${i}`, cluster_id: "c1", stopped_on: null, angle: "category" })),
      { id: "qs", text: "stopped", cluster_id: "c2", stopped_on: "2026-09-30", angle: null },
      { id: "qu", text: "ungrouped", cluster_id: null, stopped_on: null, angle: null },
    ],
    keywords: [{ id: "k1", keyword: "crm software" }],
  });
  assert.deepEqual(
    cards.map((c) => [c.id, c.keyword, c.prompts.length]),
    [
      ["c1", "crm software", SETUP_PROMPTS],
      ["c2", null, 0],
    ],
  );
  assert.equal(confirmLabel(true), "Confirm - these are what you'll target");
});

test("R166 step 6: the admin setup state names the first confirm, else why there is none", () => {
  const rows = [
    { created_at: "2026-10-04T09:00:00Z", member_email: "priya@tallyroo.com" },
    { created_at: "2026-10-03T12:00:00Z", member_email: "sam@tallyroo.com" },
  ];
  assert.equal(setupState({ started_on: "2026-10-03" }, rows), "setup confirmed 2026-10-03 by sam@tallyroo.com");
  assert.equal(setupState({ started_on: "2026-10-03" }, [{ created_at: "2026-10-03T12:00:00Z", member_email: null }]), "setup confirmed 2026-10-03");
  assert.equal(setupState({ started_on: "2026-10-03" }, []), "setup not confirmed yet");
  assert.equal(setupState({ started_on: "2026-09-20" }, []), "set up by hand (before the setup page)");
  assert.equal(setupState({ started_on: null }, []), "set up by hand (before the setup page)");
});

test("8 Oct 2026: an ended first client is not where a member lands, by /app or by email", async () => {
  const { landingIndex } = await import("./setup-landing.ts");
  assert.equal(landingIndex([{ status: "ended" }, { status: "active" }]), 1);
  assert.equal(landingIndex([{ status: "active" }, { status: "ended" }]), 0);
  assert.equal(landingIndex([{}, { status: "active" }]), 0, "no status is not ended");
  assert.equal(landingIndex([{ status: "ended" }]), 0, "all ended: still somewhere to land");
  const clients = [{ slug: "old", confirmed: true, status: "ended" }, { slug: "new", confirmed: false, status: "active" }];
  assert.equal(landingAfterAuth({ next: null, clients }), "/app/new/setup");
  assert.equal(landingAfterAuth({ next: null, clients: [clients[0]!, { ...clients[1]!, confirmed: true }] }), "/app/new");
});
