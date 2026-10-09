import { appPath } from "../app-host.ts";

import { draftPrompts } from "./add-cluster.ts";
import { ADMIN_LIMITS } from "./decide.ts";
import { PROMPTS_PER_CLUSTER } from "./limits.ts";
import { type SlotWhy, fullLine, slotRefusal } from "./slot.ts";

/**
 * ON-1 (9 Oct 2026, launch blocker LB8): self-serve prompts for a cluster
 * that has its keyword and no prompt. A signup with no scan makes a "Needs a
 * keyword" cluster with no prompts, and the runner skips a client with no
 * live prompt (decide.ts shouldTrack), so a trial buyer waited on a person.
 * Now the card drafts five from the keyword (add-cluster.ts draftPrompts, free
 * and deterministic - no read, no model call), the member edits them, and
 * Save posts them to the free slot's route (/prompt), which writes them as
 * "Start tracking this cluster" writes its five (new-cluster.ts fillDrafts).
 *
 * Pure: which cards offer drafts, the five posted fields read back, and the
 * 303 to the setup card with what happened - drawn from fixed words, never
 * from text in the URL.
 */

/** The five drafts a card offers: only a cluster with a keyword and no live prompt, which is what the runner would skip. */
export function draftsFor(c: { keyword: string | null; prompts: readonly unknown[] }): string[] | null {
  return c.keyword && c.prompts.length === 0 ? draftPrompts(c.keyword) : null;
}

/** The posted field for the i-th draft, in ANGLES order. */
export const draftField = (i: number) => `p-${i}`;

/**
 * The five drafted prompts a form posted, or null when it posted none (the
 * free slot's one `text`). A missing field reads as "" so the drafts' rule
 * refuses it; each is cut one past the longest a prompt may be, so an
 * over-long one is still refused rather than trimmed into a pass.
 */
export function readDrafts(get: (k: string) => unknown): string[] | null {
  if (typeof get(draftField(0)) !== "string") return null;
  return Array.from({ length: PROMPTS_PER_CLUSTER }, (_, i) => {
    const v = get(draftField(i));
    return typeof v === "string" ? v.slice(0, ADMIN_LIMITS.question + 1) : "";
  });
}

export type DraftsDone = "saved" | "refused";

/**
 * Where /prompt sends a setup card's drafts back to: the card, saying what
 * happened. A refusal carries its rule's code (slot.ts SLOT_WHY) and, for a
 * text refusal, which field (0-4) it is about (ON-1 review, 9 Oct 2026) -
 * never the text itself - and drops the fragment, so that field can take
 * focus, as the keyword route does.
 */
export function draftsReturn(slug: string, card: string, ok: boolean, why: SlotWhy | null = null, at: number | null = null): string {
  const q = new URLSearchParams({ card, drafts: ok ? "saved" : "refused" });
  if (!ok && why) q.set("why", why);
  if (!ok && at !== null && Number.isInteger(at) && at >= 0 && at < PROMPTS_PER_CLUSTER) q.set("at", String(at));
  return appPath(`/${encodeURIComponent(slug)}/setup?${q}${ok ? `#card-${encodeURIComponent(card)}` : ""}`);
}

/** The refused field from the 303's `at`: one of the five, else none. */
export function draftAt(raw: string | null): number | null {
  if (raw === null || !/^\d$/.test(raw)) return null;
  const n = Number(raw);
  return n < PROMPTS_PER_CLUSTER ? n : null;
}

/** What a refused card says after its reason: the typed text never rides in the URL, so the fields come back as drafted. */
export const DRAFTS_RESET = "Nothing was saved, and the five fields are back as drafted.";

/**
 * The setup card's line after Save, from the 303's `drafts` and `why` only.
 * Null when the URL says neither. `when` is the first check that reads them,
 * as check-time.ts words it ("tomorrow at 06:00 UK time", "on 11 Oct at
 * 1:00am ET"). `live` is the card's live prompts as the page draws it, so a
 * "full" refusal says the real count (slot.ts fullLine).
 */
export function draftsLine(done: string | null, why: string | null, when: string, live = 0): { ok: boolean; text: string } | null {
  if (done === "saved") return { ok: true, text: `Saved. They are first asked ${when}.` };
  if (done !== "refused") return null;
  if (why === "full") return { ok: false, text: fullLine(live, PROMPTS_PER_CLUSTER) };
  return { ok: false, text: `${slotRefusal(why) ?? "Those prompts did not save."} ${DRAFTS_RESET}` };
}
