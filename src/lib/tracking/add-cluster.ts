import { createHmac } from "node:crypto";

import { constantTimeEqual } from "../constant-time.ts";
import { keywordForm } from "../scan/dataforseo-request.ts";
import type { ClusterKeywordPick } from "../scan/target-keyword.ts";

import { PROMPTS_PER_CLUSTER } from "./limits.ts";
import { refuseDraftsAt } from "./prompt-text.ts";

/**
 * "Add a cluster" on the Clusters page - BRIEF-3 T6 part 3a (30 Sep 2026;
 * boards-3/Questions.dc.html "Check keyword"). Pure and unwired.
 *
 * The check has two halves. `precheckKeyword` is free and runs first, so a
 * keyword that can never pass - already tracked, the client's own brand,
 * informational, or one word - spends nothing. Only a keyword that stands
 * goes to C1's paid reads (volume and intent, then `pickClusterKeyword`), and
 * `checkVerdict` turns that pick into the board's words. The route that makes
 * those reads is a spender and comes with its own cap and census entries.
 */

export type KeywordCheck =
  | { ok: true; keyword: string; volume: number; intent: "commercial" | "transactional"; message: string }
  | { ok: false; reason: "tracked" | "own_brand" | "informational" | "too_broad" | "no_volume" | "read_failed" | "capped"; ask: boolean; message: string };

export type Refused = Extract<KeywordCheck, { ok: false }>;

const MESSAGES: Record<Refused["reason"], string> = {
  tracked: "You already track this keyword.",
  own_brand: "That is your own brand, so it only finds people who already know you. Pick a term buyers search before they do.",
  informational: "This reads as informational: people searching it want an explanation, not a supplier. Placements link on the keyword, so it has to be one buyers search.",
  too_broad: "Too broad to place against on its own. Add what it is for, for example “invoicing software for agencies”.",
  no_volume: "Google shows no measured searches for this. Placements link on the keyword, so it has to be one buyers search.",
  read_failed: "We could not read this keyword just now. Try again, or ask us to pick one.",
  capped: "That is today's keyword checks for this account used. Try again tomorrow, or ask us to pick one.",
};

export const refused = (reason: Refused["reason"]): Refused => ({ ok: false, reason, ask: reason !== "tracked", message: MESSAGES[reason] });

// The board's rule for a keyword that asks for an explanation rather than a supplier.
const QUESTION_START = /^(how|what|why|when|who|is|are|can|does|do)\b/;
const EXPLAINER = /\b(meaning|definition|examples|guide|tutorial|template|jobs|salary|course)\b/;

/** The free checks, before any read. `brands` are the client's own names and domain stems. */
export function precheckKeyword(raw: string, p: { tracked: readonly string[]; brands: readonly string[] }): { ok: true; keyword: string } | Refused {
  const k = keywordForm(raw);
  if (p.tracked.some((t) => keywordForm(t) === k)) return refused("tracked");
  const bare = k.replace(/[^a-z0-9]/g, "");
  if (p.brands.some((b) => {
    const s = keywordForm(b).replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/g, "");
    return s.length >= 3 && bare.includes(s);
  })) return refused("own_brand");
  if (QUESTION_START.test(k) || EXPLAINER.test(k)) return refused("informational");
  if (k.split(" ").filter(Boolean).length < 2) return refused("too_broad");
  return { ok: true, keyword: k };
}

/** C1's pick for the one typed keyword, in the board's words. `where` is the market, e.g. "the United States". */
export function checkVerdict(pick: ClusterKeywordPick | "read_failed", where: string): KeywordCheck {
  if (pick === "read_failed") return refused("read_failed");
  if ("none" in pick) return refused(pick.none === "no_intent" ? "informational" : pick.none === "no_volume" ? "no_volume" : "too_broad");
  return { ok: true, ...pick, message: `${pick.volume.toLocaleString("en-GB")} searches a month in ${where}, ${pick.intent} intent. Good to track.` };
}

/** At the limit the panel offers the pack instead of the check. */
export function addPanelState(used: number, clusterLimit: number): "open" | "full" {
  return used >= clusterLimit ? "full" : "open";
}

/**
 * The check travels back to the page in the 303's query string (part 3b):
 * `ck` is `ok` or a reason, and a pass carries its volume and intent. The page
 * rebuilds the words from these with `verdictFromQuery`, so nothing typed
 * into a URL is ever shown as a message - only the keyword, as an input value.
 */
export function verdictQuery(c: KeywordCheck): Record<string, string> {
  return c.ok ? { ck: "ok", vol: String(c.volume), intent: c.intent } : { ck: c.reason };
}

export function verdictFromQuery(get: (k: string) => string | null, keyword: string, where: string): KeywordCheck | null {
  const ck = get("ck");
  if (ck === "ok") {
    const volume = Number(get("vol"));
    const intent = get("intent");
    if (!keyword || !Number.isInteger(volume) || volume <= 0 || (intent !== "commercial" && intent !== "transactional")) return null;
    return checkVerdict({ keyword, volume, intent }, where);
  }
  return ck !== null && Object.hasOwn(MESSAGES, ck) ? refused(ck as Refused["reason"]) : null;
}

/**
 * Step 2 (part 3c): the five angle prompts the board drafts from a keyword
 * that passed, in ANGLES order, for the member to edit. The board's fifth
 * names a competitor; the page has no competitor it can stand behind for
 * every client, so it asks for an alternative to the best-known one.
 *
 * R171 (Danny, 2 Oct 2026, danny.md line 180): the verbs agree with the
 * keyword's head noun - the word before its first "for", "in", "near" and so
 * on, else its last - and a service keyword (agencies, consultants, plumbers)
 * gets prompts about working with someone rather than setting up a tool. A
 * leading "best" or "top" is dropped so it is not said twice. Only new drafts
 * change; a prompt's text is fixed once it has a reading.
 */
const PREPOSITIONS = new Set(["for", "in", "near", "with", "to", "on", "at", "from", "around"]);
const SERVICE_HEADS = new Set([
  "agency", "agencies", "consultant", "consultants", "consultancy", "consultancies", "firm", "firms", "company", "companies",
  "service", "services", "provider", "providers", "specialist", "specialists", "expert", "experts", "freelancer", "freelancers",
  "contractor", "contractors", "lawyer", "lawyers", "solicitor", "solicitors", "accountant", "accountants", "accountancy",
  "bookkeeper", "bookkeepers", "plumber", "plumbers", "electrician", "electricians", "dentist", "dentists", "clinic", "clinics",
  "studio", "studios", "partner", "partners", "developer", "developers", "designer", "designers", "coach", "coaches",
  "trainer", "trainers", "therapist", "therapists", "builder", "builders", "installer", "installers", "advisor", "advisors",
  "adviser", "advisers", "broker", "brokers", "photographer", "photographers", "cleaner", "cleaners", "surveyor", "surveyors",
]);

/** The head noun of a keyword: the word before its first preposition, else its last word. */
export function keywordHead(k: string): string {
  const words = k.split(" ");
  const at = words.findIndex((w, i) => i > 0 && PREPOSITIONS.has(w));
  return words[at > 0 ? at - 1 : words.length - 1] ?? "";
}

/** A plural head: agencies, tools, coaches - not business, status, analysis or analytics. */
export function isPluralHead(w: string): boolean {
  if (/(sses|xes|ches|shes|ies)$/.test(w)) return true;
  return /[^siu]s$/.test(w) && !/ics$/.test(w);
}

export function draftPrompts(keyword: string): string[] {
  const k = keywordForm(keyword).replace(/^(?:the )?(?:best|top)\s+/, "");
  const head = keywordHead(k);
  const many = isPluralHead(head);
  if (SERVICE_HEADS.has(head)) {
    return many
      ? [`Who are the best ${k}?`, `Which ${k} are easiest to work with?`, `Which ${k} do small businesses recommend?`, `Which ${k} get results fastest?`, `What are good alternatives to the best-known ${k}?`]
      : [`Who is the best ${k}?`, `Which ${k} is easiest to work with?`, `Which ${k} do small businesses recommend?`, `Which ${k} gets results fastest?`, `What’s a good alternative to the best-known ${k}?`];
  }
  return many
    ? [`What are the best ${k}?`, `Which ${k} are easiest to set up and use?`, `Which ${k} do small businesses recommend?`, `Which ${k} save the most time each month?`, `What are good alternatives to the best-known ${k}?`]
    : [`What’s the best ${k}?`, `Which ${k} is easiest to set up and use?`, `Which ${k} do small businesses recommend?`, `Which ${k} saves the most time each month?`, `What’s a good alternative to the best-known ${k}?`];
}

/**
 * The five typed prompts: each 8 to ADMIN_LIMITS.question characters, no two
 * the same. Since the ON-1 review (9 Oct 2026) two the same in the batch is
 * its own refusal (prompt-text.ts PROMPT_TWIN, code "twin"), not "already
 * tracked", which nothing is yet; refuseDraftsAt also says which field.
 */
export function refuseDrafts(texts: readonly string[]): string | null {
  return refuseDraftsAt(texts, PROMPTS_PER_CLUSTER)?.message ?? null;
}

/**
 * A pass is signed on its way back through the URL, so "Start tracking this
 * cluster" can trust the volume and intent without paying for the reads again,
 * and a hand-made URL cannot skip the check. Bound to the client and the day.
 */
export function signCheck(p: { clientId: string; keyword: string; volume: number; intent: string; day: string }, secret: string): string {
  return createHmac("sha256", secret).update(`cluster-check|${p.clientId}|${keywordForm(p.keyword)}|${p.volume}|${p.intent}|${p.day}`).digest("hex");
}

export function verifyCheck(p: { clientId: string; keyword: string; volume: number; intent: string; day: string }, sig: string | null, secret: string): boolean {
  if (!sig || !secret) return false;
  return constantTimeEqual(sig, signCheck(p, secret));
}
