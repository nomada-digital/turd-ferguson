import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The marker that keeps an unverified claim from reading as a verified one.
 *
 * AGENTS.md draws its hardest line here: "ship it rough" covers layout, copy and
 * bugs, and does not cover a number about a client's result, a claim about a
 * competitor, or a statement about what an engine does - those carry a marker
 * until there is a dated source, because "the cost of a wrong one is not a
 * scruffy page". `blocked.md` item 1 is seven legal facts shipping as these
 * markers right now, on a privacy policy.
 *
 * ## What was actually wrong
 *
 * Three pages carried it and nothing joined them. `/legal` and the vibe-retail
 * case study each had a byte-identical private `Gap`; `/white-label` wrote the
 * `<mark>` inline with `[TO CONFIRM: ...]` typed into the JSX - and that one was
 * missing `fontSize: "0.95em"`. So the page that did not go through a helper was
 * the page that had lost a property, which is the date formatter for the third
 * time in this repo, and nothing here could see it.
 *
 * The drift was cosmetic. The next one need not be: a `<mark>` that loses its
 * background is an unconfirmed legal fact rendered as running text on the one
 * page where that matters most.
 *
 * ## Why the string check is the load-bearing half
 *
 * Making a component does not stop the next page typing the marker by hand -
 * `/white-label` is the proof, since a helper already existed twice when it was
 * written. So the rule is not "a component exists", it is "the words cannot
 * appear in a page except through it".
 */

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(HERE, "..", "..", "..");
const SRC = join(ROOT, "src");
const COMPONENT = "src/components/ToConfirm.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

const posix = (f: string) => relative(ROOT, f).split(sep).join("/");
const FILES = walk(SRC).map((f) => ({ file: posix(f), source: readFileSync(f, "utf8") }));

test("the walk read the tree, so a zero below cannot pass as a clean sweep", () => {
  assert.ok(FILES.length >= 100, `the walk found only ${FILES.length} source files`);
  assert.ok(
    FILES.some((f) => f.file === COMPONENT),
    `the walk cannot see ${COMPONENT}, which every rule here is about`,
  );
});

/**
 * Pages that render the marker. Derived, not typed: a page joins by using the
 * component, and the floor below is what stops the derivation going quiet.
 */
const USERS = FILES.filter((f) => f.file !== COMPONENT && /<ToConfirm[\s>]/.test(f.source));

test("every page that renders the marker is recorded here - none, since 26 Sep 2026", () => {
  // Three when this was written - /legal, /white-label and the vibe-retail case
  // study. If this ever drops to zero it means every claim got its source, which
  // is good news and wants a deliberate edit here rather than a silent pass.
  //
  // Two since 25 Sep 2026: /legal's markers came off the public page on Danny's
  // hand-over of the call. Each sentence they sat beside is true without them;
  // the open facts (company number, registered address, ICO number, review
  // date, retention for claimed scans and contact messages, DPAs, PECR) are one
  // item on docs/blocked.md rather than orange text on a live privacy policy.
  //
  // Zero since 26 Sep 2026 (Danny, dropped rather than confirmed): /white-label's
  // "the clause wording" came off, leaving "Written into the agreement.", and the
  // vibe-retail Method card's "how many prompts were in the set, and the dates
  // each reading covers" was cut with its paragraph. Nothing was filled in; the
  // sentences that stayed are true without the marker. The floor becomes an
  // exact census: the component and the rules below stay, so the next claim
  // that needs a marker joins here by a deliberate edit to this list.
  //
  // 8 Oct 2026 (LB1): "Written into the agreement." came off /white-label as
  // well, and the home FAQ's "it is in the agreement" with it - /legal
  // publishes no agreement for either to point at. Still zero markers.
  assert.deepEqual(
    USERS.map((u) => u.file),
    [],
    `pages render ToConfirm and none did as of 26 Sep 2026 - record each one here: ${USERS.map((u) => u.file).join(", ")}`,
  );
});

test("nobody types the marker by hand - it only comes from the component", () => {
  const typed: string[] = [];
  for (const { file, source } of FILES) {
    if (file === COMPONENT) continue;
    // Comments stripped, so prose *about* the marker - which this tree now has
    // a good deal of - is not read as a page rendering one.
    code(source)
      .split("\n")
      .forEach((line, i) => {
        // The rendered words, not the identifier. A page may import TO_CONFIRM;
        // what it may not do is write the bracketed marker into its own JSX.
        if (/\[\s*TO CONFIRM\s*:/.test(line)) typed.push(`${file}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepEqual(
    typed,
    [],
    "these write the unverified-claim marker by hand instead of rendering <ToConfirm>. That is how /white-label ended up as the one copy missing a property - use the component so the next change reaches every page at once.",
  );
});

/**
 * Comments stripped before anything is matched.
 *
 * Load-bearing, and it was found by the harness rather than reasoned about: the
 * first draft of the check below read the raw source, and replacing the
 * component's `<mark>` with a `<span>` came back MISSED. The reason is that
 * `ToConfirm.tsx`'s own doc comment contains the words `<mark>` while
 * explaining what `/white-label` used to write by hand - so the prose describing
 * the element satisfied the check that the element was still there.
 *
 * `config/contact.ts` has now recorded that failure about its own comments three
 * times, `input-bounds.test.mts` a fourth, and this is the fifth. It arrives in
 * the test written to stop it every single time.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const COMPONENT_SOURCE = () => code(readFileSync(join(ROOT, ...COMPONENT.split("/")), "utf8"));

/**
 * The properties that make it a marker rather than a sentence.
 *
 * Read out of the source because the property is visual and there is no DOM
 * here - the same reason `constant-time.test.mts` reads a shape. Deliberately
 * the three that carry meaning: a distinct background, a distinct foreground,
 * and the brackets. Padding and radius are styling and are not asserted.
 */
test("the marker is still visually distinct from the text around it", () => {
  const source = COMPONENT_SOURCE();
  assert.ok(/<mark\b/.test(source), "ToConfirm no longer renders a <mark> - it is read aloud as emphasis, not only painted");
  assert.ok(/background:\s*T\.warnBg/.test(source), "the marker lost its warn background and now reads as running text");
  assert.ok(/color:\s*T\.warnFg/.test(source), "the marker lost its warn foreground");
  assert.ok(
    /\[\{TO_CONFIRM\}:/.test(source),
    "the marker no longer opens with a bracketed TO CONFIRM, which is the part that survives a stylesheet not loading",
  );
});

test("the words are read from the constant, never retyped inside the component", () => {
  const source = COMPONENT_SOURCE();
  assert.ok(/export const TO_CONFIRM = "TO CONFIRM";/.test(source));
  // And that the JSX interpolates it rather than carrying a second copy - the
  // blind-palette species, where a value is compared against a duplicate of
  // itself and the original goes unread.
  assert.ok(
    !/>\s*\[TO CONFIRM/.test(source),
    "the component types the words as well as declaring them - interpolate the constant",
  );
});
