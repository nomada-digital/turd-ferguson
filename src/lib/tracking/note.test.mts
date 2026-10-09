import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NOTE_SAID, addNote, noteCodeOf, noteReturn, noteState, readNote } from "./note.ts";

/** T7 part 4b (30 Sep 2026): "Add a note" - the text rule, the return URL, and the refusals before any write. */

test("a note is trimmed and single-spaced, 1 to 200 characters", () => {
  assert.deepEqual(readNote("  Landing page\n relaunched. "), { text: "Landing page relaunched." });
  assert.match(readNote("   ") as string, /Write a note/);
  assert.match(readNote(undefined) as string, /Write a note/);
  assert.match(readNote("x".repeat(201)) as string, /200 characters/);
  assert.deepEqual(readNote("x".repeat(200)), { text: "x".repeat(200) });
});

test("R151 (3 Oct 2026): a note's refusal comes back as its own code, and only a code is read from the URL", () => {
  assert.equal(noteCodeOf(readNote("   ") as string), "empty");
  assert.equal(noteCodeOf(readNote("x".repeat(201)) as string), "long");
  assert.equal(noteCodeOf("Could not save the note: timeout"), "refused", "a failed write names no rule");
  assert.doesNotMatch(NOTE_SAID.refused, /characters|owners/, "a failed write is not told about rules it kept");
  assert.equal(noteState("empty"), "empty");
  assert.equal(noteState("toString"), null, "own keys only");
  assert.equal(noteState(["saved"]), null);
  assert.equal(noteState(undefined), null);
});

test("the return URL is rebuilt from checked parts only", () => {
  const sp = new URLSearchParams({ cluster: "c1", q: "q1-2", prompt: "1", from: "2026-09-02", to: "2026-09-29", compare: "month", engine: "gemini", next: "https://example.com/elsewhere" });
  assert.equal(noteReturn("tallyroo", sp), "/app/tallyroo/clusters/c1?from=2026-09-02&to=2026-09-29&compare=month&prompt=1&engine=gemini");
  assert.equal(noteReturn("tallyroo", new URLSearchParams({ cluster: "c1", q: "q1-1", prompt: "12", compare: "x" })), "/app/tallyroo/clusters/c1?prompt=0");
  // DB-2 (9 Oct 2026): a picked day comes back as a day, or not at all.
  assert.equal(noteReturn("tallyroo", new URLSearchParams({ cluster: "c1", q: "q1-1", prompt: "1", day: "2026-09-22", engine: "gemini" })), "/app/tallyroo/clusters/c1?prompt=1&day=2026-09-22&engine=gemini");
  assert.equal(noteReturn("tallyroo", new URLSearchParams({ cluster: "c1", q: "q1-1", day: "22 Sep" })), "/app/tallyroo/clusters/c1?prompt=0");
  assert.equal(noteReturn("tallyroo", new URLSearchParams({ cluster: "../x", q: "q1" })), null);
  assert.equal(noteReturn("tallyroo", new URLSearchParams({ cluster: "c1" })), null);
});

function recording(question: { id: string } | null) {
  const writes: unknown[] = [];
  const db = {
    from(name: string) {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: name === "tracked_questions" ? question : null, error: null }),
        insert: async (row: unknown) => {
          writes.push([name, row]);
          return { error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, writes };
}

const P = { clientId: "cl", clusterId: "c1", questionId: "q1", text: "Relaunched.", email: "owner@example.com", today: "2026-09-30" };

test("a viewer, and a prompt not in this client's cluster, are refused before any write", async () => {
  const v = recording({ id: "q1" });
  assert.deepEqual(await addNote(v.db, { ...P, role: "viewer" }), { ok: false, message: "Only owners and editors can change what is tracked." });
  const o = recording(null);
  assert.match(((await addNote(o.db, { ...P, role: "owner" })) as { message: string }).message, /not in this client's cluster/);
  assert.equal(v.writes.length + o.writes.length, 0);
});

test("an editor's note is one insert: today, on the prompt, with the member's email", async () => {
  const r = recording({ id: "q1" });
  assert.deepEqual(await addNote(r.db, { ...P, role: "editor" }), { ok: true });
  assert.deepEqual(r.writes, [["tracking_notes", { client_domain_id: "cl", note_date: "2026-09-30", text: "Relaunched.", question_id: "q1", author_email: "owner@example.com" }]]);
});
