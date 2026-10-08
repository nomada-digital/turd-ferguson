import { brandKey } from "../scan/brand-name.ts";
import { type AnswerRow, type CitationRow, type CitedPageRow, type Range, type Rate, brandBoard, brandsRead, citedPageRows, rate } from "./figures.ts";

/**
 * Who is named (R143, 1 Oct 2026; BRIEF-4 P3): the full page of the
 * Overview's "Who is named instead" panel. Every row is `figures.ts`
 * brandBoard's - the same share of every brand mention, the same change in
 * points - so with no filter a row here reads what the panel reads for the
 * same range (named-figures.test.mts holds it). This adds the depth: answers
 * naming each brand, the engines that named it and the prompts it was named
 * in, each with days named of days answered.
 *
 * The cluster and engine filters narrow the answers first, then the same
 * helper runs on what is left, so a filtered share is a share of the brand
 * mentions in that cluster or on that engine.
 *
 * Answers whose other brands were not read (figures.ts brandsRead, 8 Oct
 * 2026, audit data-6) are dropped with the filters, so the page's answer
 * count, engines and days are the board's basis, not the named rate's.
 *
 * Plain module, relative imports only, so node --test can load it.
 */

export type NamedPrompt = { id: string; daysNamed: number; daysAnswered: number };

export type NamedRow = {
  key: string;
  name: string;
  you: boolean;
  /** Answers naming the brand in range: one answer is one mention. */
  answers: number;
  share: Rate;
  delta: number | null;
  /** Named in range but not in the comparison range. */
  isNew: boolean;
  engines: string[];
  /** Most days named first. */
  prompts: NamedPrompt[];
};

export type NamedPage = { rows: NamedRow[]; answers: number; brands: number };

/** The top rows drawn before "Show all". */
export const NAMED_TOP = 50;

const within = (d: string, r: Range) => d >= r.from && d <= r.to;

export function namedPage(input: { answers: AnswerRow[]; range: Range; before: Range | null; you: string; only?: ReadonlySet<string> | null; engine?: string | null }): NamedPage {
  const rows = input.answers.filter((a) => brandsRead(a) && (!input.only || input.only.has(a.question_id)) && (!input.engine || a.engine === input.engine));
  const board = brandBoard(rows, input.range, input.before, input.you);
  const youKey = brandKey(input.you);

  // Per brand: engines, and per prompt the days it was named. Per prompt: the days it had an answer.
  const engines = new Map<string, Set<string>>();
  const named = new Map<string, Map<string, Set<string>>>();
  const answered = new Map<string, Set<string>>();
  let total = 0;
  for (const a of rows) {
    if (!a.answered || !within(a.run_date, input.range)) continue;
    total++;
    const days = answered.get(a.question_id) ?? new Set<string>();
    days.add(a.run_date);
    answered.set(a.question_id, days);
    const keys = new Set(a.brands.map(brandKey));
    if (a.named) keys.add(youKey);
    for (const k of keys) {
      const e = engines.get(k) ?? new Set<string>();
      e.add(a.engine);
      engines.set(k, e);
      const byPrompt = named.get(k) ?? new Map<string, Set<string>>();
      const d = byPrompt.get(a.question_id) ?? new Set<string>();
      d.add(a.run_date);
      byPrompt.set(a.question_id, d);
      named.set(k, byPrompt);
    }
  }

  const toRow = (b: (typeof board)[number]): NamedRow => ({
    key: b.key,
    name: b.name,
    you: b.you,
    answers: b.share.num,
    share: b.share,
    delta: b.delta,
    isNew: b.before === 0,
    engines: [...(engines.get(b.key) ?? [])],
    prompts: [...(named.get(b.key) ?? new Map<string, Set<string>>()).entries()]
      .map(([id, d]) => ({ id, daysNamed: d.size, daysAnswered: answered.get(id)?.size ?? 0 }))
      .sort((x, y) => y.daysNamed - x.daysNamed || y.daysAnswered - x.daysAnswered),
  });

  const mine = board.find((b) => b.you);
  // The client's own row is always first, drawn at 0 when no answer named them.
  const own: NamedRow = mine
    ? toRow(mine)
    : { key: youKey, name: input.you, you: true, answers: 0, share: rate(0, board.reduce((s, b) => s + b.share.num, 0)), delta: null, isNew: false, engines: [], prompts: [] };
  const others = board.filter((b) => !b.you).map(toRow);
  return { rows: [own, ...others], answers: total, brands: board.length };
}

/** Pages drawn under an open row. */
export const CITED_WITH_TOP = 3;

/**
 * R173 pass 2 (pass 1's P3, task 8): the pages cited in the answers that
 * name one brand - not "the brand's pages", which no code here can judge.
 * Same filters as namedPage, then citedPageRows on what is left, so each
 * count is a count of citations in those answers. The client's own row
 * reads the answers that named them.
 */
export function citedWithBrand(input: { answers: (AnswerRow & CitationRow)[]; range: Range; key: string; you: string; domain: string; only?: ReadonlySet<string> | null; engine?: string | null }): CitedPageRow[] {
  const youKey = brandKey(input.you);
  const rows = input.answers.filter(
    (a) =>
      a.answered &&
      brandsRead(a) &&
      (!input.only || input.only.has(a.question_id)) &&
      (!input.engine || a.engine === input.engine) &&
      (a.brands.some((b) => brandKey(b) === input.key) || (a.named && input.key === youKey)),
  );
  return citedPageRows(rows, input.range, input.domain).slice(0, CITED_WITH_TOP);
}

/** `?open=` names a row by its folded key; anything else opens none. */
export function openKey(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && /^[a-z0-9]{1,80}$/.test(raw) ? raw : null;
}
