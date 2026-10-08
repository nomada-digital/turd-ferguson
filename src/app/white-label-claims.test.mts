import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { CAPABILITIES } from "../config/capabilities.ts";
import { gatesIn, withholds } from "./capability-gates.mts";
import { blocksOf, headClaims, pageText, PRERENDER_DIR, schemaClaims, sweptPages, type Page } from "./dynamic-render.mts";

/**
 * What the site says about where the white-label line sits.
 *
 * `/white-label` exists to state that line, and it is the one page on this site
 * that argues for its own honesty in its source: "a white-label page that
 * claimed every surface was the agency's would be the less useful page and the
 * less true one". Its `ROWS` table is therefore the site's single record of
 * which surface carries whose branding - three rows are the agency's, three are
 * not - and **the rest of the site restates part of it by hand**: all four tier
 * pages, both agency pages, the homepage block, the homepage hero and a
 * `/compare` row. One of them contradicted it outright:
 *
 * - `/alwayseverywhere` listed "White-label throughout, including the partner
 *   agreement" as a deliverable. The table says invoices and contracts are
 *   "Ours, to you". An agency reading the tier page would expect to sign an
 *   agreement under its own name; the page that states the line says the
 *   opposite, two clicks away.
 * - `/pr-agencies` closed on a bare "White-labelled throughout." - universal,
 *   unbounded, and false against three rows of that table.
 * - The homepage white-label block said dashboards "carry your logo and your
 *   domain", where the table says "on your subdomain if you want one" - an
 *   option and a subdomain, stated as a flat fact and a domain.
 *
 * This is the shape that paid on `67bc96d`, one level over: **something already
 * knows the answer, and the copy was repeating it rather than reading it.**
 * There the reader was `basePrice`; here it is a table on a page in the nav.
 *
 * **Every trigger below is derived from that table.** None of the rules fires
 * at all unless the table actually names a surface that is not the agency's -
 * so the day white-labelling genuinely does cover everything, the table gains
 * six "Yours" rows, these rules step aside, and the copy is free to say so.
 * Nothing here holds a copy of a sentence it is checking.
 *
 * **Proved against ten injections, 10/10, by `docs/inject-white-label.mjs`** -
 * both original sentences put back through a real `next build`, the table
 * flattened to all-"Yours", a not-the-agency's surface claimed as the agency's,
 * the row parse broken, `blocksOf` broken, a claim hidden in a meta description
 * for this file and for `price-claims`, and two green-expected cases.
 *
 * **The homepage fix is NOT held by anything here, and that is deliberate
 * rather than an omission.** "carry your logo and your domain" against the
 * table's "on your subdomain if you want one" is a qualifier dropped, not a
 * claim inverted - every rule that would catch it has to know which words on a
 * page are promises, and a rule that loose would fire on most of the site. It
 * is corrected copy with no tripwire. Do not read its absence as coverage.
 *
 * **What the injection run found that reading did not**, and the reason the
 * bound rule is phrased the way it is: the defect said "including the partner
 * agreement", and **"agreement" is a word the table never uses.** A rule
 * keyed on the table's own surface vocabulary - invoices, contracts, outreach,
 * publishers - is blind to it, and that was the first draft. What catches it is
 * not the noun but the quantifier: an unbounded universal is false whatever it
 * goes on to name. The vocabulary rule is kept for the other direction, where
 * it does fire, and its own injection is what earns it.
 *
 * **8 Oct 2026, LB1: the table was the ground truth, and the table was
 * wrong.** Every rule here checks the site against the table; nothing checked
 * the table against the product. Two of its three "Yours" rows - "The
 * visibility dashboard: Your logo and colours" and "Monthly reporting: none
 * of our marks" - described a white label that is not built (the dashboard
 * draws our mark in every mode, the sign-in mail says alwaystracked, a report
 * is a CSV), so this file was enforcing a false line faithfully. Those rows
 * now sit inside `listIf` with the capability they claim
 * (`config/capabilities.ts`), and this file reads a row as the table's only
 * while its gate is open: the rules derive from the LIVE rows, the live rows
 * must render, and a withheld row must not. `capability-claims.test.mts` is
 * the check against the product. The fact moved from "three rows are the
 * agency's" to one - "Placement summaries" - and is recorded below.
 */

const PAGE = "src/app/white-label/page.tsx";

type Row = { surface: string; brand: string; note: string };

/**
 * The branding table, read off the source.
 *
 * A `.mts` test cannot import a `.tsx` - Node's runner strips types without
 * parsing JSX - so this parses the literal, the way `price-claims.test.mts`
 * parses `pricing.ts`. The three fields are captured as one ordered tuple
 * inside a single row object rather than as three independent scans, so a row
 * missing one of them shortens the result instead of pairing one row's surface
 * with another row's brand.
 */
function parseRows(source: string): (Row & { at: number })[] {
  const re = /\{\s*surface:\s*"([^"]+)",\s*brand:\s*"([^"]+)",\s*note:\s*"([^"]+)"\s*\}/g;
  return [...source.matchAll(re)].map((m) => ({ surface: m[1]!, brand: m[2]!, note: m[3]!, at: m.index }));
}

const source = readFileSync(PAGE, "utf8");
const ROWS = parseRows(source);

/**
 * Which rows the page draws today. A row inside a gate whose capability is off
 * is withheld (8 Oct 2026): it is a claim waiting on the product, not part of
 * the line the page states, so no rule below derives from it.
 */
const GATES = gatesIn(source);
const isWithheld = (at: number) => GATES.some((g) => g.start <= at && at < g.end && withholds(g, CAPABILITIES));
const LIVE = ROWS.filter((r) => !isWithheld(r.at));
const WITHHELD = ROWS.filter((r) => isWithheld(r.at));

/** The agency's surfaces, and the ones that are not. "Yours" is the table's
 *  own word for the agency and the only value that means it; "Ours",
 *  "Ours, to you" and "The publisher's" are all not-the-agency's, and the
 *  distinction between those three does not matter to any rule here. Live
 *  rows only, since 8 Oct 2026. */
const AGENCY = LIVE.filter((r) => r.brand === "Yours");
const NOT_AGENCY = LIVE.filter((r) => r.brand !== "Yours");

/**
 * Every swept page, chrome included.
 *
 * Deliberately not cut down the way `price-claims.test.mts` cuts its one
 * disclosure rule: every rule here is a PROHIBITION, and wider is right for a
 * prohibition because a false claim in the footer is still a false claim. The
 * distinction matters more than usual on this subject - the nav carries a
 * "White label" link, so the phrase appears on all 30 pages. Any rule here
 * phrased as a requirement would have been satisfied by that link everywhere at
 * once and could never have fired, which is the exact trap `price-claims`
 * walked into with the footer's tier list.
 */
// Read only when there is a build, so the source-only rules above still run on
// an unbuilt tree; the build-required test below fails there either way.
const pages: Page[] = existsSync(PRERENDER_DIR) ? sweptPages() : [];

/**
 * A page as claims, one block at a time.
 *
 * `blocksOf` rather than a sentence split over `pageText`, and this file is why
 * that helper exists. Two of the rules below ask whether ONE claim says two
 * things, and a sentence split cannot answer that on this site: `/compare`'s
 * table and `/alwaystracked`'s includes list carry no punctuation at all until
 * the paragraph after them, so eleven rows arrive as one run. The first draft
 * of the vocabulary rule reported three defects that way and all three were
 * true copy read eleven rows apart - "Places your brand into those source
 * pages" paired with "your own outreach team", from opposite ends of a table.
 *
 * **The head is in the denominator too, and it was not in the first draft.**
 * `pageText` and `blocksOf` both strip whole tags, so a meta description - an
 * attribute - is invisible to either. That is the surface a reader sees BEFORE
 * the page, and `/alwayseverywhere`'s description and `/seo-agencies`'s are
 * both white-label claims. Injecting "White-labelled throughout." into a
 * description on 20 Sep passed every rule in this file. Found by asking the
 * refill question of this sweep minutes after writing it, which is the whole
 * argument for asking it then: a run later this would have read as a sweep over
 * the pages, with no sign that "the page" had ever meant only half of one.
 *
 * **And the structured data, for the third time and the same reason.** Asking
 * the same question again one surface out: `blocksOf` opens by dropping every
 * `<script>` whole, so no rule here had ever read a `ld+json` block.
 * `/alwayseverywhere`'s Service node publishes its standfirst - "still
 * entirely under your brand" - to the surface an answer engine reads, and
 * this file could not see it. `schemaClaims` says why the strip itself stays
 * and why only prohibitions take it.
 */
function claimsOf(page: Page): string[] {
  return [...blocksOf(page.html), ...headClaims(page.html), ...schemaClaims(page.html)];
}

/**
 * A white-label claim quantified over everything.
 *
 * The quantifier has to be adjacent to the thing it quantifies, which cost
 * `price-claims.test.mts` two false positives before it was written down. A
 * loose "a universal anywhere, a white-label word anywhere else" fires on the
 * homepage's "Nothing a client opens says alwayscited on it", which is true and
 * is the sentence this whole file vindicates.
 */
const UNIVERSAL_WL =
  /\bwhite[- ]labell?(?:ed|ing)?\b[^.?!]{0,40}?\b(?:throughout|everywhere|on everything|on every surface|across everything|across every surface)\b|\b(?:everything|every surface)\b[^.?!]{0,40}?\bwhite[- ]labell?(?:ed|ing)?\b/i;

/** The bound that makes a universal true. Every row of the table, including the
 *  three that are not the agency's, is a surface the client never sees under
 *  our name - the published article carries neither name, and outreach and
 *  invoices never reach them. So "everything your client sees" is sound where
 *  "everything" is not, and it is the table's own word for the limit: two of
 *  its notes end "your client never sees it". */
const CLIENT = /\bclients?\b/i;

/** A sentence assigning branding to the agency. */
const AGENCY_BRAND =
  /\byour (?:logo|brand|branding|colours|name|marks)\b|\bnone of our marks\b|\bunder your (?:brand|name)\b|\bcarr(?:y|ies) your\b/i;

/** Content words out of a surface label, for the vocabulary rule. Derived from
 *  the table rather than typed, so a new not-the-agency's row brings its own
 *  nouns with it. */
function nounsOf(surface: string): string[] {
  const stop = new Set(["the", "to", "and", "a", "of", "on", "in", "for", "with"]);
  return surface
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !stop.has(w));
}

test("the parse reads every row the page declares, so this file cannot go blind", () => {
  /** Counted on `surface: "`, with the quote, not on `{ surface:`. The row
   *  type is declared inline above the array - `{ surface: string; brand:
   *  string; note: string }[]` - so a brace-keyed count reads 7 where the array
   *  holds 6, and the floor fails on a correct file. A count floor that is
   *  wrong about the denominator is the one thing it exists not to be. */
  const declared = (source.match(/surface:\s*"/g) ?? []).length;
  assert.ok(declared > 0, "no row literal in " + PAGE + " - the parse, not the page, is what changed");
  assert.equal(ROWS.length, declared, "the parse found " + ROWS.length + " rows where the page declares " + declared);
  assert.equal(new Set(ROWS.map((r) => r.surface)).size, ROWS.length, "two rows parsed with the same surface");
});

test("the rows the product cannot back are withheld - two, as of 8 Oct 2026", () => {
  /**
   * The dated fact. "The visibility dashboard" waits on `dashboardBranding`
   * (AG-2) and "Monthly reporting" on `reportBranding` (RP-1). When either
   * ships, its flag flips in `config/capabilities.ts`, the row returns in its
   * own words, and this list moves with the date - one edit beside the
   * evidence, not a silent change in what the rules below derive from.
   */
  assert.deepEqual(
    WITHHELD.map((r) => r.surface),
    ["The visibility dashboard", "Monthly reporting"],
  );
  assert.deepEqual(
    AGENCY.map((r) => r.surface),
    ["Placement summaries"],
    "the agency's live rows moved - record it here with the reason and the date",
  );
});

test("the pages this checks against were actually built", () => {
  assert.ok(pages.length > 15, "no build to read - run `npm run build` then `npm run capture`");
});

test("the table still names a surface that is not the agency's", () => {
  /**
   * The honest-version property, and the one thing on this page that nothing
   * held. The page's own source argues for it - a table claiming every surface
   * was the agency's "would be the less useful page and the less true one" -
   * and that argument lived in a doc comment, which is prose. Flatten the three
   * not-"Yours" rows to "Yours" and the page becomes a lie while every other
   * check on this site stays green.
   *
   * It is also the trigger for every rule below. If this ever legitimately
   * becomes false, those rules go quiet rather than wrong.
   */
  assert.ok(
    NOT_AGENCY.length > 0,
    "every row of the white-label table is the agency's, so the page no longer states a line at all",
  );
  assert.ok(AGENCY.length > 0, "no row is the agency's, so the page is not describing white labelling");
});

test("the table's surfaces are on the rendered page, not only in the source", () => {
  /**
   * The floor under the parse. Every rule here derives from a literal in a
   * `.tsx`, and a literal that stops being rendered - moved behind a flag,
   * dropped from the JSX, replaced by a second hardcoded table - leaves this
   * file checking a page nobody reads. Scoped to the one page on purpose: a
   * requirement read across the whole site is satisfied by chrome, which is how
   * `price-claims` wrote a rule that could never fire.
   */
  const wl = pages.find((p) => p.page.endsWith("white-label.html"));
  assert.ok(wl, "no /white-label in the build, so the table this file derives from reaches no reader");
  const body = pageText(wl.html).replace(/\s+/g, " ");
  const missing = LIVE.filter((r) => !body.includes(r.surface)).map((r) => r.surface);
  assert.deepEqual(missing, [], "a row in the source table does not render on /white-label");
  // And the other way, since 8 Oct 2026: a withheld row is a claim the
  // product cannot back, so finding it rendered means its gate is not wired.
  const leaked = WITHHELD.filter((r) => body.includes(r.surface) || body.includes(r.note)).map((r) => r.surface);
  assert.deepEqual(leaked, [], "a row withheld behind an off capability renders on /white-label");
});

test("no page claims white labelling covers everything", () => {
  /**
   * The defect, both instances. "White-label throughout, including the partner
   * agreement" and "White-labelled throughout." are universal claims over a set
   * the site's own table says has three exceptions in it.
   *
   * Two-way on purpose, and this is the half that makes it a rule rather than a
   * ban: a universal bounded by what the client sees is *true*, on every row of
   * the table, and both sentences are fixed by adding that bound rather than by
   * deleting the claim. So the site is free to say white labelling covers
   * everything a client sees, and not free to say it covers everything.
   */
  if (NOT_AGENCY.length === 0) return;

  const bad: string[] = [];
  for (const p of pages) {
    for (const s of claimsOf(p)) {
      if (!UNIVERSAL_WL.test(s)) continue;
      if (!CLIENT.test(s)) bad.push(p.page + ": " + s);
    }
  }
  assert.deepEqual(
    bad,
    [],
    "a sentence claims white labelling covers everything, with no bound. " +
      NOT_AGENCY.length +
      " surfaces are not the agency's: " +
      NOT_AGENCY.map((r) => r.surface + " (" + r.brand + ")").join(", "),
  );
});

test("no page gives the agency's branding to a surface the table says is not theirs", () => {
  /**
   * The same claim read from the other end. The rule above catches a sentence
   * that quantifies; this one catches a sentence that names - "invoices carry
   * your logo", "the placement outreach goes out under your brand" - which no
   * quantifier rule can see.
   *
   * It did NOT catch the defect this file was written for, and that is written
   * into the header rather than hidden here: the tier page said "including the
   * partner agreement", and the table's word is "contracts". A vocabulary
   * derived from a table cannot know the synonyms a sales page will reach for.
   * It is kept because it fires on its own injection and because it is the only
   * rule here that reads the pairing rather than the quantity.
   *
   * **It carries no exemption, including for `/white-label` itself**, and that
   * is worth stating because the first draft needed one. At sentence
   * granularity the table's own cells collapsed into a single run, so the page
   * that defines the vocabulary tripped the rule that derives from it - and the
   * honest-looking fix was to exempt the denominator. `blocksOf` removed the
   * need instead: each cell is its own block, so a surface label and a branding
   * note are never in the same claim. An exemption that a better primitive
   * dissolves was never an exemption, it was a bug with a sentence beside it.
   */
  if (NOT_AGENCY.length === 0) return;

  const vocabulary = NOT_AGENCY.map((r) => ({ surface: r.surface, nouns: nounsOf(r.surface) }));
  assert.ok(
    vocabulary.every((v) => v.nouns.length > 0),
    "a not-the-agency's row yields no noun, so this rule is blind to it: " +
      vocabulary.filter((v) => !v.nouns.length).map((v) => v.surface).join(", "),
  );

  const bad: string[] = [];
  for (const p of pages) {
    for (const s of claimsOf(p)) {
      if (!AGENCY_BRAND.test(s)) continue;
      const lower = s.toLowerCase();
      for (const v of vocabulary) {
        if (v.nouns.some((n) => lower.includes(n))) bad.push(p.page + " [" + v.surface + "]: " + s);
      }
    }
  }
  assert.deepEqual(bad, [], "a claim puts the agency's branding on a surface the white-label table says is ours");
});

test("the block split is doing something, so the two pairing rules are not reading whole pages", () => {
  /**
   * The floor under `blocksOf`, and the one this file was missing when it
   * reported three false positives. If the split ever stops finding block
   * boundaries - the markup changes, the regex rots - every rule above silently
   * widens to "anywhere on the page" and starts pairing words that are eleven
   * rows apart. That failure is green on a correct tree and red on a correct
   * tree in turn; what it is never is accurate.
   *
   * `/compare` is the sharpest case on the site: one table, no punctuation
   * until the paragraph after it. A sentence split returns a handful of runs
   * for it; a block split returns one per cell.
   */
  const cmp = pages.find((p) => p.page.endsWith("compare.html"));
  assert.ok(cmp, "no /compare in the build - it is the page this floor is measured on");

  const sentences = pageText(cmp.html)
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+|(?<=[.?!])(?=[A-Z])/)
    .filter((s) => s.trim());
  const blocks = claimsOf(cmp);
  assert.ok(
    blocks.length > sentences.length * 3,
    "the block split found " +
      blocks.length +
      " claims where a sentence split found " +
      sentences.length +
      " - the boundaries are not being found and the pairing rules have gone page-wide",
  );
});
