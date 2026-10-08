import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NEXT_STEPS } from "./onboarding.ts";
import { welcome } from "../lib/email/lifecycle.ts";

/**
 * The 3-step strip (R166, Danny, danny.md line 175, 1 Oct 2026): drawn on
 * every tier page, /packages and /checkout, and the welcome email repeats it.
 * One copy in onboarding.ts; this holds each place to it.
 */

const SRC = join(fileURLToPath(import.meta.url), "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

// PackagePage draws all four tier pages.
const SURFACES = ["components/PackagePage.tsx", "app/packages/page.tsx", "app/checkout/page.tsx"];

test("the strip is drawn on the tier pages, /packages and /checkout", () => {
  for (const file of SURFACES) {
    assert.match(read(file), /<NextSteps\b/, `${file} does not draw the 3-step strip`);
  }
  for (const tier of ["alwaystracked", "alwaysmentioned", "alwayscited", "alwayseverywhere"]) {
    assert.match(read(`app/${tier}/page.tsx`), /PackagePage/, `/${tier} is not drawn by PackagePage`);
  }
});

// 8 Oct 2026 (audit activation-16): welcome takes the plan's clusterLimit, and its
// trial version (trial_started) carries the same strip.
test("the welcome email lists the same three steps, paid and on the trial", () => {
  const paid = welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x" });
  const trial = welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x", trial: { ends: "22 Oct 2026, 3:30pm ET", charge: "$1 a month", billing: "https://example.com/b" } });
  assert.equal(NEXT_STEPS.length, 3);
  for (const mail of [paid, trial]) for (const step of NEXT_STEPS) assert.ok(mail.text.includes(step), `welcome text lacks "${step}"`);
});

test("no placement timeline in the strip", () => {
  for (const step of NEXT_STEPS) {
    assert.doesNotMatch(step, /placement|placed|publish|\bweeks?\b|\bmonths?\b|\bdays?\b/i, step);
  }
});
