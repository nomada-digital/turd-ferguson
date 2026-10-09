import { clockIn } from "./check-time.ts";
import type { Day } from "./figures.ts";

/**
 * "Latest answers" on the one-cluster page (T7 part 3b, 30 Sep 2026;
 * boards-3/QuestionDetail.dc.html): for the picked prompt, what each engine
 * said at its latest check in the range. Pure; the repo reads the rows.
 *
 * - One tab per engine in the tier's order. An engine with no row that day,
 *   or a row it did not answer, is a tab that says so - never "not named".
 * - The text is the stored answer with link addresses taken out, as the
 *   board's footnote says: a markdown link keeps its words, a bare URL goes.
 *   No word the engine wrote is otherwise changed.
 * - "Pages it cited" are the citations as host and path - no scheme, no
 *   `www.`, no query or fragment - each once, in the engine's order.
 */

export type LatestRow = {
  engine: string;
  answered: boolean;
  named: boolean;
  text: string | null;
  brands: string[];
  /** False when the runner's brand extraction failed for this answer (tracking_answers.brands_ok, 8 Oct 2026); absent is read. */
  brands_ok?: boolean;
  citations: { source_domain: string; url: string | null }[];
  /** When the answer was stored, ISO. */
  at: string | null;
};

export type AnswerTab = {
  engine: string;
  /** null: no answer from this engine at that check. */
  named: boolean | null;
  text: string | null;
  /** The answer's time in the client's zone, "06:10 UK time" or "2:10am ET" (check-time.ts clockIn, 9 Oct 2026). */
  time: string | null;
  pages: string[];
  /** The client first if named, then the others in the order the engine gave them. */
  brands: { name: string; you: boolean }[];
  /** False when the other brands were not read at this check, so `brands` may be short of them - never "None". */
  othersRead: boolean;
};

export function answerTabs(rows: LatestRow[], engines: readonly string[], you: string, market: string): AnswerTab[] {
  return engines.map((engine) => {
    const r = rows.find((x) => x.engine === engine && x.answered);
    if (!r) return { engine, named: null, text: null, time: null, pages: [], brands: [], othersRead: true };
    const seen = new Set<string>();
    const pages: string[] = [];
    for (const c of r.citations) {
      const p = pageLabel(c.url ?? c.source_domain);
      if (p && !seen.has(p)) {
        seen.add(p);
        pages.push(p);
      }
    }
    const others = new Map<string, string>();
    for (const b of r.brands) if (b.toLowerCase() !== you.toLowerCase() && !others.has(b.toLowerCase())) others.set(b.toLowerCase(), b);
    return {
      engine,
      named: r.named,
      text: r.text?.trim() ? withoutLinks(r.text) : null,
      time: r.at ? clockIn(r.at, market) : null,
      pages,
      brands: [...(r.named ? [{ name: you, you: true }] : []), ...[...others.values()].map((name) => ({ name, you: false }))],
      othersRead: r.brands_ok !== false,
    };
  });
}

/** `?engine=` on the one-cluster page: an engine of the tier; anything else is the first. */
export function engineTab(raw: string | string[] | undefined, engines: readonly string[]): string {
  return typeof raw === "string" && engines.includes(raw) ? raw : engines[0]!;
}

/** `https://www.Example.com/a/b/?q=1#x` to `example.com/a/b`; null for anything that is not a web address or host. */
export function pageLabel(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return u.hostname.toLowerCase().replace(/^www\./, "") + path;
}

/** Markdown links keep their words; bare web addresses and the brackets left round them go. */
export function withoutLinks(text: string): string {
  return text
    .replace(/\[([^\]\n]*)\]\((?:https?:\/\/|www\.)[^)\s]*\)/gi, "$1")
    .replace(/\s*[(<](?:https?:\/\/|www\.)[^\s)>]*[)>]/gi, "")
    .replace(/\s*(?:https?:\/\/|www\.)[^\s)>\]]+/gi, "")
    .replace(/[ \t]+$/gm, "");
}

/** The text split round every whole-word mention of the brand, for the highlight. */
export function brandRuns(text: string, brand: string): { text: string; brand: boolean }[] {
  const b = brand.trim();
  if (!b) return [{ text, brand: false }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
  const out: { text: string; brand: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), brand: false });
    out.push({ text: m[0], brand: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), brand: false });
  return out;
}

export type LatestAnswers = { day: Day | null; rows: LatestRow[] };
