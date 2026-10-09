import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_LIMITS } from "./decide.ts";
import { angleFor, insertPrompts } from "./limits.ts";
import { refuseRole, stopDay } from "./stop.ts";

/**
 * The free slot on the Clusters page - BRIEF-3 T6 part 2c (30 Sep 2026;
 * boards-3/Questions.dc.html): a stopped prompt's place becomes an input, and
 * what is typed there is tracked as a new prompt in the same cluster, at the
 * stopped prompt's angle. A new row, never the old one rewritten, so two
 * prompts never share a history.
 *
 * It is first read at tomorrow's daily check (`added_on` is tomorrow, as the
 * admin adds are), which is what the board's toast says. The room is limits.ts's
 * rule: the cluster must have fewer than 5 live prompts and the client room
 * under its limit; `insertPrompts` refuses otherwise. Owners and editors only.
 */

/** A prompt is 8 to ADMIN_LIMITS.question characters - the admin form's rule, one fact. */
export const PROMPT_MIN = 8;

export function refuseSlotText(text: string, live: readonly string[]): string | null {
  const t = text.trim();
  if (t.length < PROMPT_MIN || t.length > ADMIN_LIMITS.question) return `A prompt is ${PROMPT_MIN} to ${ADMIN_LIMITS.question} characters.`;
  if (live.some((l) => l.trim().toLowerCase() === t.toLowerCase())) return "That prompt is already tracked in this cluster.";
  return null;
}

/**
 * R151 (3 Oct 2026): a refused free slot came back as "Reload the page and try
 * again" whatever the rule, and reloading cannot unduplicate a prompt or free
 * room in a cluster (NN/g heuristic 9). The route carries one of these codes
 * back in `why`; the page draws the fixed words. A failed read or write has no
 * code and keeps the old line.
 */
export const SLOT_WHY = {
  length: `A prompt is ${PROMPT_MIN} to ${ADMIN_LIMITS.question} characters.`,
  duplicate: "That prompt is already tracked in this cluster. Type a different one.",
  full: "That cluster already has its 5 live prompts. Stop one first.",
  plan: "Every prompt on your plan is in use. Stop one first.",
  stopped: "That cluster is stopped.",
  // The pending cluster's Save changes (edit route) refuses by the same text rule, plus this one.
  fixed: "It already has readings, so its text is fixed. Stop it and add a new one.",
  // Undo (stop route) refuses by stop.ts refuseUndo and refuseRoom; the room ones share full and plan above.
  effect: "That stop has taken effect. Add it again as a new one.",
  parent: "Its cluster is stopped. Undo the cluster instead.",
  clusters: "Every cluster on your plan is in use. Stop one first.",
  // "Start tracking this cluster" (cluster route) adds these two; Move (group route) shares full and stopped.
  tracked: "You already track this keyword. Check a different one.",
  recheck: "That keyword check has run out. Check the keyword again.",
} as const;
export type SlotWhy = keyof typeof SLOT_WHY;

/** A rule's refusal (refuseSlotText, refusePrompts, a stopped cluster) as its code, or null for anything else. */
export function slotWhyOf(message: string): SlotWhy | null {
  if (message.startsWith("A prompt is ")) return "length";
  if (message === "That prompt is already tracked in this cluster.") return "duplicate";
  if (message.startsWith("That cluster already has ") || (message.startsWith("That cluster has ") && message.includes(" more would pass "))) return "full";
  if (message.startsWith("At the limit of ")) return message.includes("prompts") ? "plan" : message.includes("clusters") ? "clusters" : null;
  if (message === "That cluster is stopped.") return "stopped";
  if (message.startsWith("It already has readings")) return "fixed";
  if (message === SLOT_WHY.effect) return "effect";
  if (message === SLOT_WHY.parent) return "parent";
  if (message === "You already track this keyword.") return "tracked";
  if (message === "The keyword check did not verify.") return "recheck";
  return null;
}

/** A code from the URL to its words, own keys only; anything else is null. */
export const slotRefusal = (raw: string | null): string | null => (raw !== null && Object.hasOwn(SLOT_WHY, raw) ? SLOT_WHY[raw as SlotWhy] : null);

export type Filled ={ ok: true; id: string } | { ok: false; message: string };

export async function fillSlot(db: SupabaseClient, p: { clientId: string; clusterId: string; angle: string | null; text: string; today: string; by: string; role: string }): Promise<Filled> {
  const r = refuseRole(p.role);
  if (r) return { ok: false, message: r };
  const { data: c, error: cErr } = await db.from("tracked_clusters").select("stopped_on").eq("id", p.clusterId).eq("client_domain_id", p.clientId).maybeSingle();
  if (cErr) return { ok: false, message: `Could not read the cluster: ${cErr.message}` };
  if (!c) return { ok: false, message: "That cluster is not on this client." };
  if (c.stopped_on !== null) return { ok: false, message: "That cluster is stopped." };
  const { data: live, error: lErr } = await db.from("tracked_questions").select("text").eq("client_domain_id", p.clientId).eq("cluster_id", p.clusterId).is("stopped_on", null);
  if (lErr) return { ok: false, message: `Could not read its prompts: ${lErr.message}` };
  const refused = refuseSlotText(p.text, (live ?? []).map((q) => q.text as string));
  if (refused) return { ok: false, message: refused };
  const w = await insertPrompts(db, p.clientId, p.clusterId, [{ text: p.text.trim(), source: "client", added_on: stopDay(p.today), added_by: p.by, angle: angleFor(p.angle) }]);
  return w.ok ? { ok: true, id: w.ids[0] } : w;
}
