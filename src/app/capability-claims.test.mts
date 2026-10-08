import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { CAPABILITIES, type Capability } from "../config/capabilities.ts";
import { sourceFiles } from "../lib/source-read.mts";
import { blankKeepingOffsets, closeOf, gatedCopy, gatesIn, withholds, type Gate } from "./capability-gates.mts";
import { blocksOf, decodeEntities, headClaims, pageText, PRERENDER_DIR, schemaClaims, sweptPages, type Page } from "./dynamic-render.mts";

/**
 * No page claims a capability the product does not have.
 *
 * ## What was wrong (LB1, 8 Oct 2026)
 *
 * The go-to-market audit read the live site against the code, every claim
 * checked by two or three adversarial verifiers, on the day the alwaystracked
 * card trial went live. Agencies are the core buyer, and the site sold them:
 *
 * - a white-label dashboard - `/white-label`'s table said "The visibility
 *   dashboard: Yours - Your logo and colours", its hero "Your client never
 *   finds out we exist" and "your name, your colours, your domain", the
 *   packages table "Your dashboards and your branding", the home FAQ "Every
 *   surface a client opens carries your branding". `Sidebar.tsx` draws our mark
 *   and the alwaystracked name in every mode and the sign-in mail is titled
 *   "Your alwaystracked login link";
 * - white-label reports "with your logo, not ours" on three tier pages and the
 *   checkout's list. A report is the range's CSVs;
 * - coverage matching and Google positions for the host article on
 *   `/alwaystracked` and its checkout lines. `placements.ts` refuses coverage
 *   below alwayseverywhere and `runner.ts` reads the client's rank only;
 * - "Per client or consolidated" invoicing, where checkout bills each client
 *   as its own subscription.
 *
 * `white-label-claims.test.mts` derived every rule from `/white-label`'s table
 * and nothing checked the table against the product, so the table's own false
 * rows were the rules' ground truth. The same species as `67bc96d` and
 * `486d63a`, one level further out: the record was right about the copy and
 * wrong about the product.
 *
 * ## The shape of the fix
 *
 * `config/capabilities.ts` is one flag per missing capability, false today.
 * Copy that claims one is written inside `listIf` / `onlyIf` naming the flags
 * it needs, so it is withheld until the flag flips, and comes back in its own
 * words when the feature ships. This file holds that shape from both ends:
 *
 * - **in the source, always**: every phrase that claims an off capability sits
 *   inside a gate naming that capability. Runs on an unbuilt tree, so it is the
 *   half that cannot skip;
 * - **on the built pages**: no claim (body blocks, head, structured data)
 *   carries a tell for an off capability, and no sentence a gate withholds is
 *   rendered anywhere. These skip without `npm run build` and `npm run
 *   capture` - and a skip is not a pass.
 *
 * ## What it cannot see
 *
 * A claim phrased in words no tell below knows. The tells are proved against
 * the copy the gates withhold today - each one must fire on a sentence a gate
 * actually wraps - so they are not guesses, but a new synonym for "your logo"
 * passes the source half. The built half's withheld-copy rule is exact about
 * the sentences it knows and blind to new ones; that is the cost of a census
 * about meaning.
 */

/** The capabilities, typed as the file declares them. */
const NAMES = Object.keys(CAPABILITIES) as Capability[];

/**
 * The words that claim each capability.
 *
 * Specific on purpose. Three near-misses this tree carries are true copy and
 * must not fire: "This tier is not white-labelled" on `/alwayseverywhere`; "The
 * host article's own ranking carries the linked page", which is about why a
 * placement moves a position, not about reporting one; and `/coverage-check`'s
 * upload, which is a public one-off tool and not the dashboard capability.
 */
const TELLS: Record<Capability, RegExp[]> = {
  dashboardBranding: [
    /\bdashboards?\b[^.]{0,40}\byour (?:logo|branding|colou?rs)\b/i,
    /\byour logo and colou?rs\b/i,
    /\bcarr(?:y|ies) your branding\b/i,
    /\b(?:one|only) place our name appears\b/i,
    /\bnever finds out we exist\b/i,
    /\b(?:is|are) white[- ]label\b/i,
    /(?<!\bnot )\bwhite[- ]labell?ed\b/i,
    // `/compare`'s row is a label and a cell, so its claim is the pairing in
    // the source; as rendered text "White label for agencies" is also the
    // `/white-label` page's own title, which is not a claim.
    /"White label for agencies",\s*values:\s*\{\s*us:\s*"Yes"/,
  ],
  reportBranding: [/\bwhite[- ]label(?:led)? report(?:s|ing)?\b/i, /\breport(?:s|ing)? with your logo\b/i, /\bnone of our marks\b/i],
  ownDomain: [/\byour colou?rs, your domain\b/i, /\b[a-z0-9-]+\.northlight\.agency\b/i],
  coverageUpload: [/\bcoverage matching\b/i, /\bupload a campaign\b/i, /\bwhich of your coverage is in that list\b/i, /\bthe date the coverage went live\b/i],
  hostArticleRankings: [/\bGoogle positions? for the (?:host )?article\b/i, /\bhost article's ranking for\b/i, /\btwo keyword sets\b/i],
  consolidatedInvoicing: [/\bconsolidated\b/i, /\bone, to you\b/i],
};

const OFF = NAMES.filter((c) => !CAPABILITIES[c]);

type File = { file: string; raw: string; blank: string; gates: Gate[] };
const FILES: File[] = sourceFiles(".").map((file) => {
  const raw = readFileSync(file, "utf8");
  return { file, raw, blank: blankKeepingOffsets(raw), gates: gatesIn(raw) };
});
const GATES = FILES.flatMap((f) => f.gates.map((g) => ({ ...g, file: f.file })));

const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;

/**
 * The prose every withholding gate wraps, for the built half's exact rule.
 *
 * A run that the source also says OUTSIDE every withholding gate is left out,
 * because finding it on a page proves nothing about the gate - "White label
 * for agencies" is both the gated `/compare` row and the `/white-label` page's
 * title.
 */
const MASKED = FILES.map((f) => {
  let s = f.blank;
  for (const g of f.gates) if (withholds(g, CAPABILITIES) && g.end > 0) s = s.slice(0, g.start) + " ".repeat(g.end - g.start) + s.slice(g.end);
  return s.replace(/\s+/g, " ");
});
const WITHHELD = [
  ...new Set(
    GATES.filter((g) => withholds(g, CAPABILITIES))
      .flatMap((g) => gatedCopy(g.text))
      .filter((s) => s.length >= 16 && !MASKED.some((m) => m.includes(s))),
  ),
];

test("the record: no capability has shipped, as of 8 Oct 2026", () => {
  /**
   * A dated fact, the shape `trial.test.mts` uses for the trial switch. A flag
   * flipped to true is a claim to every buyer at once, so it fails here until
   * the commit that ships the feature moves this line with its evidence: AG-2
   * for the dashboard, RP-1 for reports, DB-10 for coverage and the host
   * article's position. Own domain and consolidated invoicing have no build
   * item; both are Danny's.
   */
  assert.deepEqual(
    { ...CAPABILITIES },
    {
      dashboardBranding: false,
      reportBranding: false,
      ownDomain: false,
      coverageUpload: false,
      hostArticleRankings: false,
      consolidatedInvoicing: false,
    },
  );
});

test("the gate reader reads a call to its own closing parenthesis, and only a call", () => {
  /**
   * Proved on the cases the tree uses, so a rule below cannot go quiet by the
   * reader closing a span early or never closing it. A span closed early
   * leaves copy outside its gate; one never closed swallows the file and
   * excuses everything after it.
   */
  const sample = [
    'export function listIf<T>(needs: Capability, ...items: T[]): T[] {',
    '  return [];',
    '}',
    'const a = [...listIf("coverageUpload", "Upload (a campaign) and see")];',
    'const b = onlyIf(["dashboardBranding", "ownDomain"], <p>Your client\'s view, {x ? "(" : ")"}</p>) ?? "today";',
    'const c = [...listIf<Row>("dashboardBranding", { what: `rows ${n} (ok)`, cells: { a: 1 } })];',
  ].join("\n");
  const gates = gatesIn(sample);
  assert.deepEqual(
    gates.map((g) => ({ needs: g.needs, closed: g.end > 0, line: g.line })),
    [
      { needs: ["coverageUpload"], closed: true, line: 4 },
      { needs: ["dashboardBranding", "ownDomain"], closed: true, line: 5 },
      { needs: ["dashboardBranding"], closed: true, line: 6 },
    ],
    "the definition is not a gate, and each call is read with its names",
  );
  const spans = gates.map((g) => sample.slice(g.start, g.end));
  assert.deepEqual(
    spans,
    [
      'listIf("coverageUpload", "Upload (a campaign) and see")',
      'onlyIf(["dashboardBranding", "ownDomain"], <p>Your client\'s view, {x ? "(" : ")"}</p>)',
      'listIf<Row>("dashboardBranding", { what: `rows ${n} (ok)`, cells: { a: 1 } })',
    ],
    "a bracket in a string or a template, or an apostrophe in JSX text, moved where a span ends",
  );
  assert.ok(!gates[1]!.text.includes("today"), "the `??` fallback after a gate is live copy, not gated");
  assert.ok(gates[1]!.text.includes("Your client's view"), "an apostrophe in JSX text stopped the reader");
  assert.equal(closeOf("f(\"no close", 1), -1);
  assert.deepEqual(gatedCopy('"wl-top" "13px" "Upload a campaign, see which" <p>Your logo and colours.</p>'), ["Upload a campaign, see which", "Your logo and colours."]);
});

test("every gate closes and names only capabilities that exist", () => {
  const bad = GATES.filter((g) => g.end === -1 || !g.needs.length || g.needs.some((c) => !(c in CAPABILITIES)) || g.text.length > 6000).map(
    (g) => `${g.file}:${g.line} needs [${g.needs.join(", ")}]${g.end === -1 ? ", never closes" : ""}`,
  );
  assert.deepEqual(bad, [], "a gate the reader cannot place - every rule below trusts these spans");
});

test("the walk and the gates are where they were, so a clean result below is a reading", () => {
  /**
   * Floors, 8 Oct 2026: 353 source files, 28 gates in eleven files, 32
   * withheld sentences for the built half to look for. A walk that stops
   * matching reports a clean tree, and a gate reader that stops finding calls
   * reports every claim as ungated - which fails loudly - or, if the tells rot
   * with it, nothing at all. A gate taken off without its claim going too is
   * also caught here first: `/compare`'s row has no tell a page can carry.
   * Move these deliberately, with the date.
   */
  assert.ok(FILES.length >= 300, `the walk read ${FILES.length} source files`);
  assert.ok(GATES.length >= 28, `only ${GATES.length} gates found - 28 on 8 Oct 2026`);
  assert.ok(WITHHELD.length >= 32, `only ${WITHHELD.length} withheld sentences for the built half to look for - 32 on 8 Oct 2026`);
  for (const c of OFF) {
    assert.ok(
      GATES.some((g) => g.needs.includes(c)),
      `nothing is gated on ${c}, so its tells are proved against nothing - either the copy went, or the reader stopped seeing it`,
    );
  }
});

test("every tell fires on a sentence its gate withholds today", () => {
  /**
   * The proof that the tells are not decoration. Each one must match the text
   * of at least one gate naming its capability; a tell nothing gated says is a
   * guess about future copy, and a guess that never fires reads as coverage.
   */
  const dead: string[] = [];
  for (const c of OFF) {
    const texts = GATES.filter((g) => g.needs.includes(c)).map((g) => g.text);
    for (const tell of TELLS[c]) if (!texts.some((t) => tell.test(t))) dead.push(`${c}: ${tell}`);
  }
  assert.deepEqual(dead, [], "a tell matches nothing any gate withholds");
});

test("no source claims a capability that is off, outside a gate for it", () => {
  /**
   * The rule. Any phrase claiming an off capability must sit inside a gate
   * that names THAT capability - not any gate. A report line gated on the
   * dashboard flag would come back the day the dashboard ships, a day before
   * the report does.
   *
   * Comments are blanked first: this tree's doc comments quote the defects
   * they record, and prose about a claim is not the claim.
   */
  const bad: string[] = [];
  for (const f of FILES) {
    for (const c of OFF) {
      for (const tell of TELLS[c]) {
        for (const m of f.blank.matchAll(new RegExp(tell.source, tell.flags.includes("g") ? tell.flags : tell.flags + "g"))) {
          const at = m.index;
          const gated = f.gates.some((g) => g.needs.includes(c) && g.start <= at && at < g.end);
          if (!gated) bad.push(`${f.file}:${lineAt(f.raw, at)} [${c}] ${f.raw.split("\n")[lineAt(f.raw, at) - 1]!.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    "copy claims a capability config/capabilities.ts has as false. Wrap it in listIf/onlyIf with that capability, or take the claim out - flipping the flag is for the commit that ships the feature",
  );
});

// --------------------------------------------------------- the built pages

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";
const built = existsSync(PRERENDER_DIR);
const pages: Page[] = built ? sweptPages() : [];

function claimsOf(page: Page): string[] {
  return [...blocksOf(page.html), ...headClaims(page.html), ...schemaClaims(page.html)];
}

test("no built page claims a capability that is off", (t) => {
  if (!built) {
    t.skip(NEEDS_BUILD);
    return;
  }
  assert.ok(pages.length > 15, `only ${pages.length} pages - the build is not the site`);
  const bad: string[] = [];
  for (const p of pages) {
    for (const s of claimsOf(p)) {
      for (const c of OFF) if (TELLS[c].some((tell) => tell.test(s))) bad.push(`${p.page} [${c}]: ${s}`);
    }
  }
  assert.deepEqual(bad, [], "a rendered claim promises a capability the product does not have");
});

test("no sentence a gate withholds reaches a built page", (t) => {
  /**
   * The exact half. Every prose run inside a withholding gate - "Your logo and
   * colours.", "Coverage matching: upload a campaign, see which pieces are
   * cited", the hero, the compare row - is looked for on every built page.
   * This is what catches a gate that is written but not wired: a row array
   * built with `listIf` and then a second hardcoded copy rendered beside it.
   *
   * Body text is read from `</head>` on, and the head through `headClaims`,
   * so a page title is never read as body copy.
   */
  if (!built) {
    t.skip(NEEDS_BUILD);
    return;
  }
  const bad: string[] = [];
  for (const p of pages) {
    const end = p.html.indexOf("</head>");
    const body = decodeEntities(pageText(end === -1 ? p.html : p.html.slice(end))).replace(/\s+/g, " ");
    const head = [...headClaims(p.html), ...schemaClaims(p.html)].join(" \n ");
    for (const s of WITHHELD) if (body.includes(s) || head.includes(s)) bad.push(`${p.page}: ${s}`);
  }
  assert.deepEqual(bad, [], "copy a capability gate withholds is on a built page");
});
