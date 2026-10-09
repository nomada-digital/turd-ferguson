import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_LIMITS } from "./decide.ts";
import { refuseDrafts } from "./add-cluster.ts";
import { refuseCluster, refuseEdit, refuseGrouping, refusePrompts } from "./limits.ts";
import { refuseUndo } from "./stop.ts";
import { SLOT_WHY, fillSlot, refuseSlotText, slotRefusal, slotWhyOf } from "./slot.ts";

test("R151 (3 Oct 2026): every rule's refusal of a free slot has a code, and only a code comes back from the URL", () => {
  const said = [
    refuseSlotText("short", []),
    refuseSlotText("Which tool is best for this?", ["which tool is best for this?"]),
    refusePrompts({ clientLive: 4, clusterLive: 5, clusterLimit: 2 }),
    refusePrompts({ clientLive: 10, clusterLive: 2, clusterLimit: 2 }),
    "That cluster is stopped.",
  ];
  assert.deepEqual(said.map((m) => slotWhyOf(m ?? "")), ["length", "duplicate", "full", "plan", "stopped"]);
  assert.equal(slotWhyOf(refuseEdit(1) ?? ""), "fixed", "the edit route's after-first-reading refusal");
  assert.equal(SLOT_WHY.fixed, refuseEdit(1), "one sentence");
  // Undo's refusals (stop route): taken effect, a stopped parent, and no cluster room.
  assert.equal(slotWhyOf(refuseUndo({ stopped_on: "2026-10-01" }, "2026-10-03") ?? ""), "effect");
  assert.equal(slotWhyOf("Its cluster is stopped. Undo the cluster instead."), "parent");
  assert.equal(slotWhyOf(refuseCluster(3, 3) ?? ""), "clusters");
  assert.equal(slotWhyOf(refuseUndo({ stopped_on: null }, "2026-10-03") ?? ""), null, "a stale form keeps the Reload line");
  assert.equal(slotWhyOf("Could not add the prompts: timeout"), null, "a failed write keeps the Reload line");
  // Move (group route) and Start tracking this cluster (cluster route).
  assert.equal(slotWhyOf(refuseGrouping({ ids: ["a"], ungrouped: new Set(["a"]), clusterLive: 5 }) ?? ""), "full");
  assert.equal(slotWhyOf(refuseGrouping({ ids: ["a"], ungrouped: new Set(), clusterLive: 1 }) ?? ""), null, "a stale form keeps the Reload line");
  assert.equal(slotWhyOf("You already track this keyword."), "tracked");
  assert.equal(slotWhyOf("The keyword check did not verify."), "recheck");
  // ON-1 review (9 Oct 2026): two the same in one batch is its own code - nothing is tracked yet, so not "duplicate".
  assert.equal(slotWhyOf(refuseDrafts(["Which tool is best for this?", "which tool is best for this?", "Which tool suits a studio?", "Which tool do agencies use?", "Which tool saves the most time?"]) ?? ""), "twin");
  assert.equal(slotRefusal("duplicate"), SLOT_WHY.duplicate);
  assert.equal(slotRefusal("toString"), null, "own keys only");
  assert.equal(slotRefusal(SLOT_WHY.duplicate), null, "words are not a code");
  assert.equal(slotRefusal(null), null);
});

// BRIEF-3 T6 part 2c (30 Sep 2026): the free slot. The text rule, then the
// refusals that stop before any write, against a stand-in that records writes.

test("a slot's prompt is 8 to ADMIN_LIMITS.question characters and not a twin of a live one", () => {
  assert.match(refuseSlotText("short", [])!, /8 to/);
  assert.match(refuseSlotText("x".repeat(ADMIN_LIMITS.question + 1), [])!, /8 to/);
  assert.match(refuseSlotText("  Which app is best?  ", ["which app is best?"])!, /already tracked/);
  assert.equal(refuseSlotText("Which app is best for a sole trader?", ["Which app is best?"]), null);
});

function recording(cluster: { stopped_on: string | null } | null) {
  const writes: string[] = [];
  const db = {
    from(name: string) {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: async () => ({ data: name === "tracked_clusters" ? cluster : null, error: null }),
        insert: () => {
          writes.push(name);
          return b;
        },
        then: (ok: (v: unknown) => void) => ok({ data: [], error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, writes };
}

const P = { clientId: "c", clusterId: "k", angle: "sector", text: "Which app suits a design studio?", today: "2026-09-30", by: "a@example.com", role: "owner" };

test("a viewer, another client's cluster and a stopped cluster are refused before any write", async () => {
  for (const [cluster, role, msg] of [
    [{ stopped_on: null }, "viewer", /owners and editors/],
    [null, "owner", /not on this client/],
    [{ stopped_on: "2026-10-01" }, "editor", /is stopped/],
  ] as const) {
    const { db, writes } = recording(cluster);
    const r = await fillSlot(db, { ...P, role });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, msg);
    assert.deepEqual(writes, []);
  }
});
