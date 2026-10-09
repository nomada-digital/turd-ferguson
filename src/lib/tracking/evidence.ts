import { brandKey } from "../scan/brand-name.ts";
import { type AnswerRow, type CitationRow, type Day, type Range, brandsRead, citedPage } from "./figures.ts";

/**
 * Evidence links (DB-2, 9 Oct 2026): a figure or a row opens the answer that
 * produced it, on the one-cluster page with `?day=&engine=` and that engine's
 * anchor (OneCluster.tsx). /about says every figure has its words behind it;
 * until this, only the latest answer did.
 *
 * A row that counts many answers opens the latest of them in the range: its
 * day, and on that day the engine first in the tier's order - the order of
 * the one-cluster page's tabs. Each picker reads the answers its figure
 * counts, under the figure's own filters, so the answer opened is always one
 * the figure counted (evidence.test.mts holds each against its figure on the
 * fixture).
 *
 * Plain module, relative imports only, so node --test can load it.
 */

export type Evidence = { day: Day; engine: string };

/** The anchor of one engine's answer on the one-cluster page. A link that names a day and an engine ends on it. */
export function answerAnchor(engine: string): string {
  return `answer-${engine}`;
}

/**
 * A one-cluster page link: the page's own query (the range, the prompt), and,
 * with evidence, the answer's day and engine and its anchor. Without, the
 * page as it was linked before, on its latest answers.
 */
export function answerHref(path: string, query: Record<string, string>, at: Evidence | null | undefined): string {
  if (!at) return `${path}?${new URLSearchParams(query)}`;
  return `${path}?${new URLSearchParams({ ...query, day: at.day, engine: at.engine })}#${answerAnchor(at.engine)}`;
}

/** Per prompt, the latest answered row in the range that `keep` keeps; on that day, the engine first in `engines`. */
export function latestByPrompt<A extends AnswerRow>(rows: readonly A[], range: Range, engines: readonly string[], keep: (a: A) => boolean): Map<string, Evidence> {
  const rank = (e: string) => {
    const i = engines.indexOf(e);
    return i < 0 ? engines.length : i;
  };
  const out = new Map<string, Evidence>();
  for (const a of rows) {
    if (!a.answered || a.run_date < range.from || a.run_date > range.to || !keep(a)) continue;
    const was = out.get(a.question_id);
    if (!was || a.run_date > was.day || (a.run_date === was.day && rank(a.engine) < rank(was.engine))) out.set(a.question_id, { day: a.run_date, engine: a.engine });
  }
  return out;
}

/**
 * Who is named, an open row: per prompt, the latest answer that named the
 * brand `key`, on namedPage's filters - the other brands read, the picked
 * cluster's prompts, the picked engine - and its rule for naming: the brand
 * among the answer's others, or the client's own row and the answer named
 * the client. So each prompt's "Named N of M days" counts the day it opens.
 */
export function namedEvidence(input: { answers: readonly AnswerRow[]; range: Range; key: string; you: string; only?: ReadonlySet<string> | null; engine?: string | null; engines: readonly string[] }): Map<string, Evidence> {
  const youKey = brandKey(input.you);
  return latestByPrompt(
    input.answers,
    input.range,
    input.engines,
    (a) =>
      brandsRead(a) &&
      (!input.only || input.only.has(a.question_id)) &&
      (!input.engine || a.engine === input.engine) &&
      ((a.named && input.key === youKey) || a.brands.some((b) => brandKey(b) === input.key)),
  );
}

/**
 * Cited pages, an open row: per prompt, the latest answer citing `page` - by
 * figures.ts citedPage, the key the row counts by - on the page's cluster and
 * engine filters.
 */
export function citedEvidence(input: { answers: readonly (AnswerRow & CitationRow)[]; range: Range; page: string; only?: ReadonlySet<string> | null; engine?: string | null; engines: readonly string[] }): Map<string, Evidence> {
  return latestByPrompt(
    input.answers,
    input.range,
    input.engines,
    (a) => (!input.only || input.only.has(a.question_id)) && (!input.engine || a.engine === input.engine) && a.citations.some((c) => citedPage(c)?.page === input.page),
  );
}

/** Answered rows by prompt and day (`${question_id} ${run_date}`), for dayAnswerIn - only the days `range` holds, when given. */
export function answersByPromptDay<A extends AnswerRow>(rows: readonly A[], range?: Range): Map<string, A[]> {
  const out = new Map<string, A[]>();
  for (const a of rows) {
    if (!a.answered || (range && (a.run_date < range.from || a.run_date > range.to))) continue;
    const k = `${a.question_id} ${a.run_date}`;
    const list = out.get(k);
    if (list) list.push(a);
    else out.set(k, [a]);
  }
  return out;
}

/**
 * The Overview's heat-map cell - one cluster on one day - opens one of the
 * answers it counts: the first that named the client, in the card's prompt
 * order and then the engines', or with none named the first answered. A cell
 * whose share is above 0% so always opens a name, and one at 0% an answer
 * that did not name. `prompt` is the prompt's place on the card, the
 * one-cluster page's `?prompt=`. Null when none of the prompts was answered.
 */
export function dayAnswerIn(byPromptDay: ReadonlyMap<string, readonly AnswerRow[]>, prompts: readonly string[], day: Day, engines: readonly string[]): ({ prompt: number } & Evidence) | null {
  let first: ({ prompt: number } & Evidence) | null = null;
  for (let i = 0; i < prompts.length; i++) {
    const rows = byPromptDay.get(`${prompts[i]} ${day}`) ?? [];
    for (const engine of engines) {
      const a = rows.find((x) => x.engine === engine);
      if (!a) continue;
      if (a.named) return { prompt: i, day, engine };
      first ??= { prompt: i, day, engine };
    }
  }
  return first;
}
