import type { SupabaseClient } from "@supabase/supabase-js";

import { readClusterRefusal, readPromptRoom, refusePrompts } from "./limits.ts";
import { appPath } from "../app-host.ts";

/**
 * Stop and Undo on the Clusters page - BRIEF-3 T6 part 2a (30 Sep 2026;
 * decisions 6 and 7 of docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md).
 *
 * A stop never deletes. It sets `stopped_on` to tomorrow: today's 06:00 check
 * has already read the row, so today's readings stay in the figures, and
 * `liveOn()` drops the row from the next check. The slot frees at once,
 * because limits.ts counts only rows whose `stopped_on` is null.
 *
 * Undo clears `stopped_on` again, but only while the stop has not taken
 * effect (`stopped_on` still after today). After that the history is fixed;
 * the prompt is added again as a new row, so two questions never share one.
 *
 * Stopping a cluster stops its keyword and every live prompt in it on the same
 * day (decision 7). Undoing it restores the rows that carry that day, so a
 * prompt stopped on its own on an earlier day stays stopped.
 *
 * An undo takes a slot back, so it asks limits.ts first: a prompt whose slot
 * has since been filled, or a cluster when the client is at its limit, is
 * refused. A prompt inside a stopped cluster comes back only with the cluster.
 *
 * Owners and editors only; a viewer is refused here as well as in the UI. Pure
 * rules first so the tests run each one; the writers are the network half.
 */

export type StopKind = "prompt" | "cluster";
export type Stoppable = { stopped_on: string | null };

const ROLES_THAT_WRITE = new Set(["owner", "editor"]);

/** A viewer, or a role we do not know, may not stop or undo. */
export function refuseRole(role: string): string | null {
  return ROLES_THAT_WRITE.has(role) ? null : "Only owners and editors can change what is tracked.";
}

/** The day a stop made today takes effect: tomorrow's check is the first to skip it. */
export function stopDay(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function refuseStop(row: Stoppable | null): string | null {
  if (!row) return "Nothing to stop: it is not on this client.";
  return row.stopped_on === null ? null : "It is already stopped.";
}

/** Undo only while the stop is still pending - its `stopped_on` is after today. */
export function refuseUndo(row: Stoppable | null, today: string): string | null {
  if (!row) return "Nothing to undo: it is not on this client.";
  if (row.stopped_on === null) return "It is not stopped.";
  if (row.stopped_on <= today) return "That stop has taken effect. Add it again as a new one.";
  return null;
}

// ---- The form the Clusters page posts (T6 part 2b), read without trusting it. ----

/** The page state a stop returns to; anything else in the form is dropped. */
const KEPT = ["from", "to", "compare", "filter", "q", "open"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9A-Za-z_-]{1,64}$/;

export type StopForm = { kind: StopKind; id: string; undo: boolean; back: Record<string, string> };

/** The posted form, or null if its kind or id is not one we write. `search` is APP_LIMITS.search. */
export function readStopForm(get: (k: string) => string | null, search: number): StopForm | null {
  const kind = get("kind");
  const id = get("id") ?? "";
  if ((kind !== "prompt" && kind !== "cluster") || !ID.test(id)) return null;
  return { kind, id, undo: get("undo") === "1", back: readKept(get, search) };
}

/** The page state alone, each key checked as above. Also read by /check's Change keyword return (2 Oct 2026). */
export function readKept(get: (k: string) => string | null, search: number): Record<string, string> {
  const back: Record<string, string> = {};
  for (const k of KEPT) {
    const v = get(k);
    if (v === null || v === "") continue;
    if ((k === "from" || k === "to") && !DAY.test(v)) continue;
    if (k === "compare" && v !== "none" && v !== "month") continue;
    if (k === "filter" && v !== "named" && v !== "never") continue;
    if (k === "open" && !ID.test(v)) continue;
    back[k] = k === "q" ? v.slice(0, search) : v;
  }
  return back;
}

/** The toast states the page draws: what happened, to which row. Never free text from the URL. */
export type StopDone = "stopped" | "undone" | "added" | "saved" | "moved" | "refused" | "unselected" | "rekeyed";

/**
 * DS13 (R173 pass 2, 2 Oct 2026, benchmark "bulk select on prompts (stop,
 * move)"): the Ungrouped section's bulk form posts `id=selected` in the query
 * and the ticked prompts as repeated `ids` fields in the body. Stop and Move
 * then run their one-row writer once per id, so every rule still applies to
 * each prompt. BULK_MAX caps one post; a client's ungrouped list is far shorter.
 */
export const BULK_ID = "selected";
export const BULK_MAX = 100;

/** The ticked ids: well formed, each once, at most BULK_MAX. Anything else is dropped. */
export function readBulkIds(values: readonly unknown[]): string[] {
  const ids = values.filter((v): v is string => typeof v === "string" && ID.test(v) && v !== BULK_ID);
  return [...new Set(ids)].slice(0, BULK_MAX);
}

/** A bulk answer's counts: `n` of `of` ticked went through. */
export type BulkCount = { n: number; of: number };

/** Where the route sends the browser back to: the Clusters page, its state kept, with the toast. */
export function stopReturn(slug: string, f: StopForm, done: StopDone, count?: BulkCount, why?: string | null): string {
  // `ok` and `ticked`, not the /ask toast's `n` and `of`, so the two never read each other's counts.
  // `why` (R151, 3 Oct 2026): a refusal's code, e.g. slot.ts SLOT_WHY's; only on a refusal.
  const q = new URLSearchParams({ ...f.back, done, kind: f.kind, id: f.id, ...(count ? { ok: String(count.n), ticked: String(count.of) } : {}), ...(done === "refused" && why ? { why } : {}) });
  return appPath(`/${encodeURIComponent(slug)}/clusters?${q}`);
}

// ---- The writers. Each reads the row on this client, asks the rule, then writes. ----

export type Stopped = { ok: true; stoppedOn: string | null } | { ok: false; message: string };

type Row = Stoppable & { keyword_id?: string | null; cluster_id?: string | null };

async function readRow(db: SupabaseClient, kind: StopKind, clientId: string, id: string): Promise<Row | null | string> {
  const table = kind === "prompt" ? "tracked_questions" : "tracked_clusters";
  const cols = kind === "prompt" ? "stopped_on, cluster_id" : "stopped_on, keyword_id";
  const { data, error } = await db.from(table).select(cols).eq("id", id).eq("client_domain_id", clientId).maybeSingle();
  if (error) return `Could not read it: ${error.message}`;
  return (data as Row | null) ?? null;
}

/** Whether the undo would take back a slot that is no longer free. */
async function refuseRoom(db: SupabaseClient, kind: StopKind, clientId: string, row: Row): Promise<string | null> {
  if (kind === "cluster") return readClusterRefusal(db, clientId);
  if (row.cluster_id) {
    const cluster = await readRow(db, "cluster", clientId, row.cluster_id);
    if (typeof cluster === "string") return cluster;
    if (cluster && cluster.stopped_on !== null) return "Its cluster is stopped. Undo the cluster instead.";
  }
  const room = await readPromptRoom(db, clientId, row.cluster_id ?? null);
  return typeof room === "string" ? room : refusePrompts(room.limits);
}

/** Stop one prompt, or a cluster with its keyword and live prompts, from tomorrow. */
export async function stop(db: SupabaseClient, p: { kind: StopKind; clientId: string; id: string; today: string; by: string; role: string }): Promise<Stopped> {
  const r = refuseRole(p.role);
  if (r) return { ok: false, message: r };
  const row = await readRow(db, p.kind, p.clientId, p.id);
  if (typeof row === "string") return { ok: false, message: row };
  const refused = refuseStop(row);
  if (refused) return { ok: false, message: refused };
  const day = stopDay(p.today);
  if (p.kind === "prompt") {
    const { error } = await db.from("tracked_questions").update({ stopped_on: day, stopped_by: p.by }).eq("id", p.id).eq("client_domain_id", p.clientId).is("stopped_on", null);
    return error ? { ok: false, message: `Could not stop it: ${error.message}` } : { ok: true, stoppedOn: day };
  }
  const { error: qErr } = await db.from("tracked_questions").update({ stopped_on: day, stopped_by: p.by }).eq("cluster_id", p.id).eq("client_domain_id", p.clientId).is("stopped_on", null);
  if (qErr) return { ok: false, message: `Could not stop its prompts: ${qErr.message}` };
  if (row!.keyword_id) {
    const { error: kErr } = await db.from("tracked_keywords").update({ stopped_on: day, stopped_by: p.by }).eq("id", row!.keyword_id).eq("client_domain_id", p.clientId).is("stopped_on", null);
    if (kErr) return { ok: false, message: `Could not stop its keyword: ${kErr.message}` };
  }
  const { error: cErr } = await db.from("tracked_clusters").update({ stopped_on: day }).eq("id", p.id).eq("client_domain_id", p.clientId).is("stopped_on", null);
  return cErr ? { ok: false, message: `Could not stop the cluster: ${cErr.message}` } : { ok: true, stoppedOn: day };
}

/** Undo a stop that has not yet taken effect. A cluster restores the rows stopped with it, on its day. */
export async function undoStop(db: SupabaseClient, p: { kind: StopKind; clientId: string; id: string; today: string; role: string }): Promise<Stopped> {
  const r = refuseRole(p.role);
  if (r) return { ok: false, message: r };
  const row = await readRow(db, p.kind, p.clientId, p.id);
  if (typeof row === "string") return { ok: false, message: row };
  const refused = refuseUndo(row, p.today) ?? (await refuseRoom(db, p.kind, p.clientId, row!));
  if (refused) return { ok: false, message: refused };
  const day = row!.stopped_on!;
  const clear = { stopped_on: null, stopped_by: null };
  if (p.kind === "prompt") {
    const { error } = await db.from("tracked_questions").update(clear).eq("id", p.id).eq("client_domain_id", p.clientId).eq("stopped_on", day);
    return error ? { ok: false, message: `Could not undo it: ${error.message}` } : { ok: true, stoppedOn: null };
  }
  // The cluster first: its keyword's one-live index would refuse a keyword coming back beside a live twin.
  const { error: cErr } = await db.from("tracked_clusters").update({ stopped_on: null }).eq("id", p.id).eq("client_domain_id", p.clientId).eq("stopped_on", day);
  if (cErr) return { ok: false, message: `Could not undo the cluster: ${cErr.message}` };
  if (row!.keyword_id) {
    const { error: kErr } = await db.from("tracked_keywords").update(clear).eq("id", row!.keyword_id).eq("client_domain_id", p.clientId).eq("stopped_on", day);
    if (kErr) return { ok: false, message: `Could not undo its keyword: ${kErr.message}` };
  }
  const { error: qErr } = await db.from("tracked_questions").update(clear).eq("cluster_id", p.id).eq("client_domain_id", p.clientId).eq("stopped_on", day);
  return qErr ? { ok: false, message: `Could not undo its prompts: ${qErr.message}` } : { ok: true, stoppedOn: null };
}
