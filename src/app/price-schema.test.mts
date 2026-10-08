import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isFloorLabel } from "../config/price-label.ts";
import { inlineSectorPrices } from "../config/sector-pricing-source.ts";
import { serviceSchema } from "../config/service-schema.ts";
import { code, sourceFiles } from "../lib/source-read.mts";
import { TIER_PLAIN } from "../lib/tier-text.ts";
import { sweptPages } from "./dynamic-render.mts";

/**
 * What this site tells a machine its own plans cost.
 *
 * ## Why nothing could see this
 *
 * Every claim sweep in this tree reads a page through `pageText` or
 * `blocksOf`, and both open by dropping `<script>` whole:
 *
 *     .replace(/<script[\s\S]*?<\/script>/g, "")
 *
 * That cut is correct and deliberate - `price-surfaces.test.mts` records why,
 * because structured data carries the same claim in one contiguous run and
 * would otherwise answer a requirement rule on behalf of a card that has
 * stopped printing the number. But it also means **every `ld+json` block on
 * this site is outside every claim sweep on it**, and `headClaims` does not
 * reach them either: it reads the title and the OG and Twitter strings, which
 * live in attributes, not the head's scripts.
 *
 * So the question this file asks is the one the queue keeps paying for - of
 * what the measurement walks, what is it not reading. `price-claims` and
 * `price-surfaces` are right about every figure and every sentence they name,
 * on the visible page. Four pages on this site also publish a price in
 * machine-readable form, and no test in this tree had ever read one.
 *
 * `structured-data.test.mts` is not that reader. It asks four things of these
 * same blocks - do they parse, does every `@id` resolve, is every FAQ string
 * on the page, is every own-domain URL a real route - and all four are
 * questions about shape. An `Offer` carrying the wrong number passes every
 * one of them.
 *
 * That gap matters more here than the same gap would on most sites. This is
 * an answer-engine-optimisation product: the JSON-LD is not a nicety beside
 * the page, it is the surface the thing we sell is about being read on.
 *
 * ## What it found
 *
 * The prices themselves are safe by construction and that is worth saying
 * plainly: `serviceSchema` takes `tier.basePrice`, so a figure cannot be
 * right in the card and stale in the markup. Widening to the number alone
 * would have been decoration.
 *
 * The defect is one field over, in the judgement that decides **which kind of
 * offer** to publish. The function chose between an `AggregateOffer` with a
 * `lowPrice` and an `Offer` with a flat `price` on:
 *
 *     tier.priceLabel.startsWith("from")
 *
 * `price-label.ts` answers that exact question for the card, lowercases
 * before testing, and `price-label.test.mts` pins `"From $99/mo"` as a floor
 * with a comment saying a capitalised label must survive. So the two readers
 * of one judgement disagreed on the one input the tested reader was written
 * to handle - two copies of one function, and the untested copy the one
 * missing the guard, which is this repo's named species and the shape of the
 * date formatter, the honeypot and the brand extractor before it.
 *
 * **The direction it fails in is the one `price-label.ts` opens by naming.**
 * With `priceLabel: "From $99/mo"`, the card correctly reads "From $99/mo"
 * and the block beside it publishes `"price": 99` under a monthly
 * `UnitPriceSpecification` - a floor sold as a flat price, machine-readable,
 * to the engines this product exists to be read by. `c2bf546` and the deleted
 * `priceFor` are the same bug twice already, both in copy; this is the third
 * instance and the first one a reader could quote at us.
 *
 * **Nothing was wrong on the live site and nothing here changes a number.**
 * Every label in `pricing.ts` today opens lowercase, so both readers agree
 * and the shipped blocks are correct - which is exactly why no amount of
 * reading the output would have found it. The test that matters is the one
 * below that runs `serviceSchema` on the label the two readers disagree
 * about, because a sweep over today's four tiers passes either way.
 */

const PRICING = "src/config/pricing.ts";

/**
 * The repo root, resolved off this file rather than off the cwd.
 *
 * The reads here were cwd-relative and worked, because `npm run check` runs
 * from the root. Once one rule walks the tree the two conventions sit side by
 * side in one file, and a reader cannot tell which is load-bearing - so they
 * are one convention now. `client-results.test.mts` resolves it the same way.
 */
const ROOT = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

type Quoted = { id: string; basePrice: number | null; priceLabel: string; href: string };

/**
 * Every tier's id, base price, label and page, read off the source.
 *
 * Parsed rather than imported because `pricing.ts` imports
 * `@/components/TierName`, so no `.mts` test can load it - the constraint
 * `price-surfaces.test.mts` hit first and records. Parsed rather than retyped
 * because a test holding its own copy of the prices passes while the site
 * quotes different ones, which is the blind-tripwire shape this repo has now
 * found five times.
 *
 * An ordered quadruple inside one tier object, not four independent lists, so
 * a tier missing a field shortens the result rather than silently pairing one
 * tier's price with another's page. This is a fourth field on top of the
 * triple `price-surfaces` reads; the two parses are deliberately separate
 * rather than one shared regex, for the reason `source-read.mts` gives about
 * the six strippers - a reader that changes in one case blinds the sweep that
 * depended on that case, and both carry their own floor below.
 */
function quotedTiers(source: string): Quoted[] {
  const re =
    /id:\s*"([^"]+)"[\s\S]*?basePrice:\s*(null|\d+)[\s\S]*?priceLabel:\s*"([^"]+)"[\s\S]*?\n\s*href:\s*"([^"]+)"/g;
  return [...source.matchAll(re)].map((m) => ({
    id: m[1]!,
    basePrice: m[2] === "null" ? null : Number(m[2]),
    priceLabel: m[3]!,
    href: m[4]!,
  }));
}

/**
 * Every JSON-LD block on a page, as raw text.
 *
 * A third copy of this three-line reader rather than an import, because the
 * other two live in `.test.mts` files and importing a reader out of one makes
 * node run that whole suite a second time - `source-read.mts` exists because
 * that was done once and was visible only as a suite reporting twice. If a
 * fourth reader ever needs it, it goes in `dynamic-render.mts` beside the
 * other page readers rather than becoming a fourth copy.
 *
 * The RSC flight payload holds a serialised copy of the same elements, but in
 * flight a script is a `["$","script",null,{...}]` tuple, so the literal
 * opening tag matched here never appears in it.
 */
function ldBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

type Node = Record<string, unknown>;

function nodesOf(parsed: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(parsed)) {
    for (const n of parsed) nodesOf(n, out);
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const o = parsed as Node;
  out.push(o);
  for (const v of Object.values(o)) nodesOf(v, out);
  return out;
}

/** The `Service` node a package page publishes for itself, if it has one. */
function serviceNodes(html: string): Node[] {
  const out: Node[] = [];
  for (const raw of ldBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Parsing is `structured-data.test.mts`'s assertion, not this file's.
      // Skipping here rather than throwing keeps a malformed block reported
      // once, by the test written for it, instead of twice with this one
      // claiming to be about prices.
      continue;
    }
    for (const n of nodesOf(parsed)) if (n["@type"] === "Service") out.push(n);
  }
  return out;
}

/** `sweptPages` names a prerendered page by its file, so `/alwaystracked` is `alwaystracked.html`. */
function pageFor(href: string): string {
  return href.replace(/^\//, "") + ".html";
}

const source = inlineSectorPrices(read(PRICING));
const TIERS = quotedTiers(source);
const PAGES = new Map(sweptPages().map((p) => [p.page, p.html]));

// ------------------------------------------------------- the denominator

test("the parse reads every tier the file declares, so this file cannot go blind", () => {
  const declared = (source.match(/^\s{4}priceLabel:/gm) ?? []).length;
  assert.ok(declared > 0, "no priceLabel found in " + PRICING + " - the parse, not the file, is what changed");
  assert.equal(TIERS.length, declared, `the parse found ${TIERS.length} tiers where the file declares ${declared}`);
  assert.equal(new Set(TIERS.map((t) => t.id)).size, TIERS.length, "two tiers parsed with the same id");
});

test("every tier's package page is in the swept set, so an absent offer is a finding", () => {
  // Without this, a page dropping out of the build reads identically to a
  // page that publishes no offer - and the second is the thing being checked.
  assert.ok(PAGES.size > 15, `only ${PAGES.size} pages swept - run \`npm run build\` and \`npm run capture\``);
  for (const t of TIERS) {
    assert.ok(PAGES.has(pageFor(t.href)), `${t.id} declares ${t.href} and the build has no ${pageFor(t.href)}`);
  }
});

// ----------------------------------------------------- what is published

test("a priced tier publishes exactly one offer and a quoted tier publishes none", (t) => {
  let priced = 0;
  let quoted = 0;
  for (const tier of TIERS) {
    const services = serviceNodes(PAGES.get(pageFor(tier.href))!);
    assert.equal(services.length, 1, `${tier.href} publishes ${services.length} Service nodes, expected 1`);
    const offers = services[0]!.offers;
    if (tier.basePrice === null) {
      quoted++;
      assert.equal(
        offers,
        undefined,
        `${tier.id} has no numeric price and publishes an offer anyway - "${tier.priceLabel}" is a call, and an ` +
          `offer node with no price says less than no offer node`,
      );
    } else {
      priced++;
      assert.ok(offers, `${tier.id} costs $${tier.basePrice} and publishes no offer node`);
    }
  }
  assert.ok(priced > 0 && quoted > 0, `${priced} priced and ${quoted} quoted - both branches must be exercised`);
  t.diagnostic(`${priced} priced tiers publish an offer, ${quoted} quoted tiers publish none`);
});

test("every published price is the price in pricing.ts", () => {
  for (const tier of TIERS) {
    if (tier.basePrice === null) continue;
    const offers = serviceNodes(PAGES.get(pageFor(tier.href))!)[0]!.offers as Node;
    const stated = offers.price ?? offers.lowPrice;
    assert.equal(
      stated,
      tier.basePrice,
      `${tier.id} is $${tier.basePrice} in ${PRICING} and $${String(stated)} in its structured data`,
    );
    const spec = offers.priceSpecification as Node | undefined;
    if (spec) {
      assert.equal(spec.price, tier.basePrice, `${tier.id}'s UnitPriceSpecification disagrees with its own Offer`);
    }
  }
});

test("a floor is published as a floor, and a flat price as a flat price", () => {
  /**
   * The property, stated once: a label that qualifies its number must not
   * reach a machine as an unqualified one. "from $99/mo" published as
   * `price: 99` is the number an agency quotes their client before finding
   * out it moves - the failure `price-label.ts` opens by naming, and the one
   * `c2bf546` and the deleted `priceFor` each shipped once already.
   */
  for (const tier of TIERS) {
    if (tier.basePrice === null) continue;
    const offers = serviceNodes(PAGES.get(pageFor(tier.href))!)[0]!.offers as Node;
    if (isFloorLabel(tier.priceLabel)) {
      assert.equal(
        offers["@type"],
        "AggregateOffer",
        `${tier.id} reads "${tier.priceLabel}" and publishes a ${String(offers["@type"])} - a floor sold as a flat price`,
      );
      assert.equal(offers.price, undefined, `${tier.id} is a floor and publishes a flat price beside its lowPrice`);
      assert.equal(offers.lowPrice, tier.basePrice);
    } else {
      assert.equal(
        offers["@type"],
        "Offer",
        `${tier.id} reads "${tier.priceLabel}", which states a flat price, and publishes ${String(offers["@type"])}`,
      );
      assert.equal(offers.lowPrice, undefined, `${tier.id} is a flat price and publishes a lowPrice`);
      assert.ok(offers.priceSpecification, `${tier.id} publishes a flat monthly price with no billing period on it`);
    }
  }
});

test("every offer names its own tier's page and a currency", () => {
  for (const tier of TIERS) {
    if (tier.basePrice === null) continue;
    const offers = serviceNodes(PAGES.get(pageFor(tier.href))!)[0]!.offers as Node;
    assert.equal(offers.priceCurrency, "USD", `${tier.id}'s offer states a number with no currency, or the wrong one`);
    assert.equal(
      offers.url,
      "https://alwayscited.com" + tier.href,
      `${tier.id}'s offer points at a page that is not its own`,
    );
  }
});

test("the name in the offer's Service node is the colourless form", () => {
  // AGENTS.md: the unstyled one-word form in every context that strips colour,
  // and JSON-LD is named in that list. `tier-lockup.test.mts` holds the
  // rendered page and reads the prerender; it cannot see inside a script.
  const plain = new Set(Object.values(TIER_PLAIN));
  for (const tier of TIERS) {
    const name = serviceNodes(PAGES.get(pageFor(tier.href))!)[0]!.name;
    assert.ok(plain.has(name as string), `${tier.href} publishes the name "${String(name)}", which is not a TIER_PLAIN form`);
  }
});

// ------------------------------------- the judgement the two readers made

test("serviceSchema calls a capitalised floor a floor", () => {
  /**
   * The case the whole finding turns on, and the only one a sweep over
   * today's four tiers cannot reach: every label in `pricing.ts` opens
   * lowercase, so `startsWith("from")` and `isFloorLabel` agree on all four
   * and the built pages are correct under either.
   *
   * `price-label.test.mts` already pins `splitPriceLabel("From $99/mo")` as a
   * floor, with a comment saying a label's own capitalisation must survive.
   * This asserts the schema path makes the same call, which it did not.
   */
  const tier = { plainName: "alwaystracked", basePrice: 99, priceLabel: "From $99/mo", href: "/alwaystracked" };
  const offers = serviceSchema(tier as never, "s").offers as Node;
  assert.equal(offers["@type"], "AggregateOffer", '"From $99/mo" published as a flat price');
  assert.equal(offers.lowPrice, 99);
  assert.equal(offers.price, undefined);
});

test("serviceSchema still calls a flat price flat", () => {
  // The other direction, so the fix above cannot be "call everything a floor".
  const tier = { plainName: "alwayscited", basePrice: 2495, priceLabel: "$2,495/mo", href: "/alwayscited" };
  const offers = serviceSchema(tier as never, "s").offers as Node;
  assert.equal(offers["@type"], "Offer");
  assert.equal(offers.price, 2495);
  assert.equal((offers.priceSpecification as Node).unitCode, "MON");
});

test("serviceSchema publishes no offer for a tier with no number", () => {
  const tier = { plainName: "alwayseverywhere", basePrice: null, priceLabel: "Book a call", href: "/alwayseverywhere" };
  assert.equal(serviceSchema(tier as never, "s").offers, undefined);
});

test("the floor judgement has one reader, and the schema is not carrying a second", () => {
  /**
   * The structural half, and it is here because the behavioural half cannot
   * cover it: a second private copy written tomorrow would agree with
   * `isFloorLabel` on every label in the file today, so every assertion above
   * would pass while the two readers were free to drift apart again. That is
   * the state this finding was found in.
   *
   * Comments stripped, because a doc comment quoting the defect it fixed
   * satisfies a check that the defect is present - paid for five times in
   * this tree and twice inside the test written to stop it. `service-schema.ts`
   * and `price-label.ts` both quote `startsWith("from")` in their headers
   * while explaining it, and a raw read reports the fix as the defect.
   *
   * **The walk was two typed filenames and is now the tree**, asked of this
   * file the same day it was written. The rule's own name is a claim about
   * every reader on the site, and it named `service-schema.ts` and
   * `PackagePage.tsx` - the two files the defect happened to be found in. A
   * third component judging a floor by hand satisfied it completely, which is
   * the state `copy.test.mts`'s `DASH_EXEMPT` was found in on the same day,
   * one sweep over: a typed list cannot report the member absent from it.
   */
  const judged: string[] = [];
  const files = sourceFiles(ROOT);
  // A walk that stopped walking returns a clean list, which is the failure
  // this rule is least able to notice.
  assert.ok(files.length >= 40, `expected 40+ source files, walked ${files.length}`);
  for (const file of files) {
    const src = code(read(file));
    if (/priceLabel[^\n]*startsWith|startsWith\(\s*"from/i.test(src)) judged.push(file);
  }
  assert.deepEqual(
    judged,
    [],
    "a floor is judged by hand here - use isFloorLabel, which lowercases first:\n" + judged.map((f) => `  ${f}`).join("\n"),
  );
  const schema = code(read("src/config/service-schema.ts"));
  assert.ok(schema.includes("isFloorLabel("), "service-schema.ts no longer reads the shared floor judgement");
});

test("the comment strip above is load-bearing", () => {
  // A green-expected case: the two files really do quote the defect in their
  // prose, so a rule reading them raw would report a fix as the defect. This
  // is recorded as HELD rather than as a pass, per the note in source-read.mts.
  const raw = read("src/config/service-schema.ts");
  assert.ok(raw.includes('startsWith("from")'), "the header stopped naming the defect - this guard is now untested");
  assert.ok(!code(raw).includes('startsWith("from")'), "the strip stopped removing it");
});

/**
 * The trial is not in the Offer markup (Danny, 8 Oct 2026): the published
 * price stays the price, whether config/trial.ts has the trial on or off.
 */
test("the trial never reaches the Offer markup, on or off", () => {
  const schema = readFileSync(new URL("../config/service-schema.ts", import.meta.url), "utf8");
  assert.doesNotMatch(schema, /trial/i, "service-schema.ts must not read the trial");
});
