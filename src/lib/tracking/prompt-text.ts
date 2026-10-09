/**
 * The rules a prompt's text is held to, with no imports at all, so the page
 * can run them in the browser before a form posts (DraftsCheck.tsx) and the
 * routes run the same functions on the server (ON-1 review, 9 Oct 2026).
 * slot.ts re-exports refuseSlotText and PROMPT_MIN for every older import, and
 * decide.ts's ADMIN_LIMITS.question is PROMPT_MAX, so the length is one fact.
 */

/** A prompt is PROMPT_MIN to PROMPT_MAX characters - the admin form's rule. */
export const PROMPT_MIN = 8;
export const PROMPT_MAX = 300;

/**
 * Two prompts are the same when their keys are. The database holds one live
 * prompt per key and cluster - tracked_questions_cluster_live_text_uniq on
 * (cluster_id, lower(btrim(text))) where stopped_on is null, 20261009040000 -
 * and the app must refuse everything that index would, so the key is at least
 * as strict: JavaScript's trim takes every space btrim does and more; the
 * text is decomposed and its marks dropped, so a precomposed letter and its
 * combining form, and "İ" (which Postgres lowers to "i" and JavaScript to
 * "i" and a dot), meet; and a final sigma is a sigma, as Postgres lowers it.
 * Stricter than the index in places ("café" and "cafe" are one prompt here),
 * never looser. A write the index still refuses is the duplicate refusal too
 * (limits.ts insertPrompts, 23505).
 */
export function promptKey(text: string): string {
  return text.trim().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ς/g, "σ");
}

export const PROMPT_LENGTH = `A prompt is ${PROMPT_MIN} to ${PROMPT_MAX} characters.`;
export const PROMPT_TRACKED = "That prompt is already tracked in this cluster.";
/** Two of the prompts posted together are the same - nothing is tracked yet, so not "already tracked". */
export const PROMPT_TWIN = "Two of these prompts are the same. Make each one different.";

/** One prompt against the cluster's live prompts: its length, then not a twin of one already tracked. */
export function refuseSlotText(text: string, live: readonly string[]): string | null {
  const t = text.trim();
  if (t.length < PROMPT_MIN || t.length > PROMPT_MAX) return PROMPT_LENGTH;
  const k = promptKey(t);
  if (live.some((l) => promptKey(l) === k)) return PROMPT_TRACKED;
  return null;
}

/**
 * The five drafted prompts posted together, or the reason they are refused
 * and which field (0-4) it is about: each one's length, then none the same as
 * one before it in the batch. Null when they pass.
 */
export function refuseDraftsAt(texts: readonly string[], count: number): { message: string; at: number | null } | null {
  if (texts.length !== count) return { message: `A cluster has ${count} prompts.`, at: null };
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!.trim();
    if (t.length < PROMPT_MIN || t.length > PROMPT_MAX) return { message: PROMPT_LENGTH, at: i };
    const k = promptKey(t);
    if (texts.slice(0, i).some((l) => promptKey(l) === k)) return { message: PROMPT_TWIN, at: i };
  }
  return null;
}
