import { checkTime, clockIn } from "./check-time.ts";
import { type Day, citedPage, formatDay } from "./figures.ts";

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
 *   `www.`, no query or fragment - each once, in the engine's order. Since
 *   the review of 95a8747 (9 Oct 2026) that is figures.ts citedPage, the key
 *   Cited pages counts by; pageLabel, a second rule for the same name, went.
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
    // Review of 95a8747 (9 Oct 2026): named by figures.ts citedPage, Cited pages' own key, so an answer opened
    // from a Cited pages row lists that row's page under the same name.
    const seen = new Set<string>();
    const pages: string[] = [];
    for (const c of r.citations) {
      const p = citedPage(c)?.page;
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

/**
 * `?day=` on the one-cluster page (DB-2, 9 Oct 2026): the check whose answers
 * the panel shows instead of the latest - a real calendar day, today or
 * before. Anything else (not a date, 31 Sep, tomorrow, the key given twice)
 * is no day, and the page is as it is with no `?day=`: no error, the latest
 * answers. Whose answers may be read is the page's rule, not this one's: the
 * read is held to the page's own client and prompt (read-shape.ts
 * readAnswerDay), and a day with no check stored says so.
 *
 * No lower bound (review of 95a8747, 9 Oct 2026). It was started_on, which is
 * not a floor for stored answers: a repeat checkout (signup.ts) and an admin
 * re-run (admin actions.ts) upsert started_on to tomorrow on a client that
 * already has answers, and decide.ts still runs a client whose started_on is
 * null - either would have hidden real answers behind the latest. Robustness,
 * not a live bug: in production on 9 Oct the three clients with answers all
 * had started_on set and none had an answer before it.
 */
export function pickedDay(raw: string | string[] | undefined, today: Day): Day | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) return null;
  return raw > today ? null : raw;
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

/**
 * The line over a picked day's answer (DB-2, 9 Oct 2026): which check it is,
 * in words, or why there is none. Review of 95a8747 (same day):
 *
 * - an engine with no answer that day is "No answer from Gemini at the check
 *   on 20 Sep 2026", not "Showing ...'s answer" over a blank tab, and no
 *   engine's name takes a possessive ("Google AI Overviews's");
 * - today, before today's check has run or while it runs, a prompt with no
 *   stored answers is waiting, not missing: it says when the check runs, in
 *   the client's zone (check-time.ts), never a typed time.
 *
 * `run` is today's run of any status (run-note.ts todayRun), null for none.
 */
export function pickedDayLine(p: { day: Day; today: Day; market: string; stored: boolean; run: { status: string } | null; label: string; answered: boolean }): string {
  const on = formatDay(p.day, true);
  if (!p.stored) {
    if (p.day === p.today && !p.run) return `Today's check, at ${checkTime(p.today, p.market)}, has not run yet. Its answers show here once it has.`;
    if (p.day === p.today && p.run?.status === "running") return "Today's check is still running. Its answers show here once it has finished.";
    return `No check of this prompt is stored for ${on}, so there is no answer from that day.`;
  }
  return p.answered ? `Showing the answer from ${p.label} at the check on ${on}.` : `No answer from ${p.label} at the check on ${on}.`;
}
