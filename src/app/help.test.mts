import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The help centre (MK-2, 9 Oct 2026) describes the product, so it goes stale
 * the way every second copy of a fact in this tree has: the product moves and
 * the description does not. Three things are held here, on the source, so
 * they run on an unbuilt tree.
 *
 * 1. **Every number in the copy is the code's.** config/help.ts interpolates
 *    each figure it states - the cluster and prompt counts, the sign-in
 *    lifetimes, the team caps, the Google depth, the prices - from the module
 *    that enforces it. A digit typed into a sentence is a copy that will not
 *    follow the code, so none is allowed. The only digits in the copy are
 *    inside `ui()` labels, which rule 2 holds to the product instead.
 * 2. **Every control the copy names is one the dashboard draws.** A sentence
 *    saying "choose Cancel trial" is wrong the day the button is renamed, and
 *    nothing else would notice. Each literal `ui("...")` label must appear in
 *    the dashboard's own source.
 * 3. **Every article is a page, and every page is offered**: one page file per
 *    article and none spare, each in sitemap.ts and the footer reaching the
 *    index. sitemap.test.mts checks the sitemap against the built pages, and
 *    skips on an unbuilt tree; this half does not skip.
 *
 * And one decision: the help promises no reply time. Danny reversed the one
 * promise of that kind (R24, 26 Sep 2026), and putting one back is his.
 *
 * What it cannot see: whether a sentence without a number or a control name
 * is still true. Those were checked by reading the code on 9 Oct 2026 and are
 * recorded in config/help.ts's header.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const HELP_SRC = "src/config/help.ts";
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Source lines that are code, not comment - the same cut client-results.test.mts makes. */
function code(src: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (open) {
      if (t.includes("*/")) open = false;
      continue;
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) open = true;
      continue;
    }
    if (t.startsWith("*") || t.startsWith("//")) continue;
    out.push(line);
  }
  return out;
}

/**
 * The prose runs on one line of source: every string or template literal that
 * holds a space, with each `${...}` taken out first, innermost first, so an
 * interpolated figure is never read as a typed one.
 */
export function proseRuns(line: string): string[] {
  let s = line;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\$\{[^{}]*\}/g, " ");
  }
  const out: string[] = [];
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)) {
    const run = m[1] ?? m[2] ?? "";
    if (/\s/.test(run)) out.push(run);
  }
  return out;
}

/** The labels written as `ui("...")`. */
export function uiLabels(src: string): string[] {
  return [...src.matchAll(/\bui\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]!);
}

/** A reply-time promise: "within a day", "in 24 hours", "the same week". */
const REPLY_TIME = /\b(?:within|in under|in)\s+(?:an?\s+|\d+\s+|one\s+|a few\s+)?(?:hours?|days?|weeks?|business|working)\b|\bsame (?:day|week)\b|\b24\s*(?:h\b|hours?)/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.includes(".test.")) out.push(rel);
  }
  return out;
}

const SRC = read(HELP_SRC);
const LINES = code(SRC);
const RUNS = LINES.flatMap(proseRuns);
const SLUGS = [...SRC.matchAll(/^\s{4}slug: "([a-z-]+)",$/gm)].map((m) => m[1]!);

/** The dashboard's own source: its pages, its components and the rules behind them. */
const PRODUCT = ["src/app/app", "src/components/app", "src/lib/tracking"].flatMap((d) => walk(d)).map((f) => ({ f, src: read(f) }));

test("the probes see what they are for", () => {
  assert.deepEqual(proseRuns('a: `Up to ${PROMPTS_PER_CLUSTER} prompts, ${x ? `#${y}` : ""} each`,'), ["Up to   prompts,   each"]);
  assert.deepEqual(proseRuns('"Up to 5 prompts"'), ["Up to 5 prompts"]);
  assert.deepEqual(proseRuns('presets("2026-10-09", null)'), [], "a value with no space is code, not prose");
  assert.deepEqual(uiLabels('`On ${ui("Clusters")}, choose ${ui("Add a cluster")}.`'), ["Clusters", "Add a cluster"]);
  for (const bad of ["We reply within a day.", "Expect an answer in 24 hours.", "usually the same week", "within 2 working days"]) {
    assert.ok(REPLY_TIME.test(bad), bad);
  }
  for (const fine of ["Tracking carries on until the trial ends", "once a day", "the day after checkout", "for 30 days"]) {
    assert.ok(!REPLY_TIME.test(fine), fine);
  }
});

test("the walk found the copy, the articles and the product, so a clean result is a reading", (t) => {
  t.diagnostic(`${SLUGS.length} articles, ${RUNS.length} prose runs, ${uiLabels(SRC).length} ui() labels, ${PRODUCT.length} dashboard source files`);
  // Floors, measured 9 Oct 2026: 7 articles, 187 prose runs, 83 control labels,
  // 97 dashboard source files. Set below the measure, so trimming a sentence
  // does not trip them, and far above what a walk that stopped matching finds.
  assert.ok(SLUGS.length >= 7, `only ${SLUGS.length} articles found in ${HELP_SRC} - 7 on 9 Oct 2026`);
  assert.ok(RUNS.length >= 150, `only ${RUNS.length} prose runs read from ${HELP_SRC} - 187 on 9 Oct 2026`);
  assert.ok(uiLabels(SRC).length >= 60, `only ${uiLabels(SRC).length} ui() labels - 83 on 9 Oct 2026`);
  assert.ok(PRODUCT.length >= 90, `only ${PRODUCT.length} dashboard source files walked - 97 on 9 Oct 2026`);
});

test("every number the help states is interpolated from the code, never typed", () => {
  const typed = RUNS.filter((r) => /\d/.test(r));
  assert.deepEqual(typed, [], `a figure is typed into the help copy - read it from the module that enforces it:\n${typed.join("\n")}`);
});

test("every control the help names is one the dashboard draws", () => {
  const missing = [...new Set(uiLabels(SRC))].filter((label) => !PRODUCT.some((p) => p.src.includes(label)));
  assert.deepEqual(missing, [], `the help names a control the dashboard no longer draws - rename it in ${HELP_SRC}:\n${missing.join("\n")}`);
});

test("the help promises no reply time (R24, 26 Sep 2026)", () => {
  const files = [HELP_SRC, "src/components/HelpShell.tsx", ...walk("src/app/help")];
  const hits = files.flatMap((f) => code(read(f)).flatMap(proseRuns).filter((r) => REPLY_TIME.test(r)).map((r) => `${f}: ${r}`));
  assert.deepEqual(hits, [], "a reply time is a promise Danny reversed; it is his to make again");
});

/**
 * Words the help renders as a link: a `link()` label, an article's title (the
 * aside and the index link it) and a section's heading (the contents link it).
 * A tier name there would be a bare word or a lockup inside a link, and both
 * are refused elsewhere - tier-lockup.test.mts on the built page, and
 * result-copy.test.mts's "no tier name sits inside a link" on the source.
 */
export function linkedWords(src: string): string[] {
  return [
    ...[...src.matchAll(/\blink\(\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? ""),
    ...[...src.matchAll(/^\s+(?:title|heading): (.+),$/gm)].map((m) => m[1]!),
  ];
}
const NAMES_A_TIER = /always(?:tracked|mentioned|cited|everywhere)\b|\$\{TRACKED\}|TIER_PLAIN/;

test("no link in the help is worded with a tier name", (t) => {
  assert.ok(NAMES_A_TIER.test('${TRACKED} help') && NAMES_A_TIER.test("alwaystracked help") && !NAMES_A_TIER.test("Billing questions"));
  // The articles only: the index's own title and heading are a page head and an h1, never a link.
  const articles = SRC.slice(SRC.indexOf("export const HELP: HelpArticle[]"), SRC.indexOf("export const QUICK"));
  assert.ok(articles.length > 1000, "the article list is not where this reads it");
  const words = linkedWords(articles);
  t.diagnostic(`${words.length} linked strings`);
  // Floor, measured 9 Oct 2026: 59 - the link labels, 7 article titles and the section headings.
  assert.ok(words.length >= 50, `only ${words.length} linked strings read - the probe has drifted`);
  const bad = words.filter((w) => NAMES_A_TIER.test(w));
  assert.deepEqual(bad, [], "a tier name in a link renders bare or as a lockup inside the link; word the link plainly and name the tier in the sentence");
});

test("every article is a page, every page is an article, and each renders its own", () => {
  const dirs = readdirSync(join(ROOT, "src/app/help"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual([...dirs].sort(), [...SLUGS].sort(), "src/app/help and the articles in config/help.ts disagree");
  for (const slug of dirs) {
    const page = read(`src/app/help/${slug}/page.tsx`);
    assert.match(page, new RegExp(`helpMetadata\\("${slug}"\\)`), `${slug}'s page carries another article's head`);
    assert.match(page, new RegExp(`<HelpArticlePage slug="${slug}" />`), `${slug}'s page renders another article`);
  }
  assert.ok(existsSync(join(ROOT, "src/app/help/page.tsx")), "the help index is gone");
});

test("every help page is offered: in the sitemap, and the footer reaches the index", () => {
  const sitemap = read("src/app/sitemap.ts");
  const offered = new Set([...sitemap.matchAll(/^\s*\["([^"]*)", "\d{4}-\d{2}-\d{2}"/gm)].map((m) => m[1]));
  const missing = ["/help", ...SLUGS.map((s) => `/help/${s}`)].filter((p) => !offered.has(p));
  assert.deepEqual(missing, [], "add these to ENTRIES in src/app/sitemap.ts");
  assert.match(read("src/components/Footer.tsx"), /\["Help", "\/help"\]/, "the footer no longer links the help centre");
});
