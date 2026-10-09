import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordForm } from "../scan/dataforseo-request.ts";

import { refuseDrafts } from "./add-cluster.ts";
import { ANGLES, insertCluster, insertKeyword, insertPrompts, readClusterRefusal } from "./limits.ts";
import { refuseRole, stopDay } from "./stop.ts";

/**
 * "Start tracking this cluster" - BRIEF-3 T6 part 3c (30 Sep 2026;
 * boards-3/Questions.dc.html). The keyword has already passed Check keyword
 * (its signed verdict is verified by the route); this writes the keyword, the
 * cluster and its five prompts through limits.ts, each first read at
 * tomorrow's daily check, as the pending cluster the board shows.
 *
 * Every refusal is read before the first write: role, the prompts' text, the
 * keyword not already tracked, and room for a cluster. The three inserts are
 * not one transaction; if a later one fails, the cluster just written is
 * stopped on its start day, so it is never read and nothing is deleted.
 */
export type Added = { ok: true; clusterId: string } | { ok: false; message: string };

export async function addCluster(
  db: SupabaseClient,
  p: { clientId: string; tier: string; keyword: string; volume: number; intent: string; prompts: string[]; today: string; by: string; role: string },
): Promise<Added> {
  const r = refuseRole(p.role) ?? refuseDrafts(p.prompts);
  if (r) return { ok: false, message: r };
  const keyword = keywordForm(p.keyword);
  const { data: kws, error } = await db.from("tracked_keywords").select("keyword").eq("client_domain_id", p.clientId).is("stopped_on", null);
  if (error) return { ok: false, message: `Could not read the keywords: ${error.message}` };
  if ((kws ?? []).some((k) => keywordForm(k.keyword as string) === keyword)) return { ok: false, message: "You already track this keyword." };
  const room = await readClusterRefusal(db, p.clientId);
  if (room) return { ok: false, message: room };

  const day = stopDay(p.today);
  const k = await insertKeyword(db, p.clientId, null, { keyword, added_on: day, added_by: p.by, search_volume: p.volume, intent: p.intent });
  if (!k.ok) return k;
  const c = await insertCluster(db, p.clientId, { name: keyword, tier: p.tier, started_on: day, keyword_id: k.ids[0] });
  if (!c.ok) return { ok: false, message: c.message + (await stopRow(db, "tracked_keywords", k.ids[0], p.clientId, day)) };
  const clusterId = c.ids[0];
  const w = await insertPrompts(db, p.clientId, clusterId, p.prompts.map((text, i) => ({ text: text.trim(), source: "client", added_on: day, added_by: p.by, angle: ANGLES[i] })));
  if (!w.ok) {
    const undone = (await stopRow(db, "tracked_clusters", clusterId, p.clientId, day)) + (await stopRow(db, "tracked_keywords", k.ids[0], p.clientId, day));
    return { ok: false, message: w.message + undone };
  }
  return { ok: true, clusterId };
}

/** Stop a row just written, on its start day, so it is never read. Says so when that fails too. */
async function stopRow(db: SupabaseClient, table: "tracked_clusters" | "tracked_keywords", id: string, clientId: string, day: string): Promise<string> {
  const { error } = await db.from(table).update({ stopped_on: day }).eq("id", id).eq("client_domain_id", clientId);
  return error ? ` Could not stop ${table} ${id} either: ${error.message}` : "";
}
