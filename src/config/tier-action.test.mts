// The tier CTA labels, one set, one source (Danny, 28 Sep 2026, R79):
// pricing.ts carries each tier's `action`, and the packages table and the tier
// page read it rather than typing their own. The old labels were three copies
// that disagreed - "Get placed" on the table, "Start a client" on the page.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const pricing = readFileSync(join(root, "config/pricing.ts"), "utf8");
const ACTIONS = { tracked: "Start tracking", mentioned: "Get recommended", cited: "Get cited", everywhere: "Be everywhere" };
const RETIRED = ["Get placed", "Go for position #1", "Talk to us", "Start a client"];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk(root);

test("each tier's action is declared once, in pricing.ts", () => {
  for (const [key, label] of Object.entries(ACTIONS)) {
    const at = pricing.indexOf(`key: "${key}"`);
    assert.ok(at > 0, `${key} is no longer a tier`);
    const block = pricing.slice(at, pricing.indexOf("\n  },", at));
    // 8 Oct 2026: alwaystracked's button names the free trial while it is on
    // (config/trial.ts TRIAL_CTA), and falls back to its own label when it is off.
    const declared = key === "tracked" ? `action: TRIAL.enabled ? TRIAL_CTA : "${label}",` : `action: "${label}",`;
    assert.ok(block.includes(declared), `${key}'s action is not ${declared}`);
  }
});

test("no component types a tier's CTA label, and the retired ones are gone", () => {
  assert.ok(files.length > 100, `only ${files.length} source files walked`);
  for (const f of files) {
    if (f.endsWith("config/pricing.ts")) continue;
    const src = readFileSync(f, "utf8");
    for (const label of [...Object.values(ACTIONS), ...RETIRED]) {
      assert.ok(!src.includes(`"${label}"`) && !src.includes(`>${label}<`) && !new RegExp(`^\\s*${label.replace(/[#]/g, "\\$&")}\\s*$`, "m").test(src), `${f.slice(root.length)} types "${label}"`);
    }
  }
});

test("the table and the tier page read the action", () => {
  assert.match(readFileSync(join(root, "components/home/Packages.tsx"), "utf8"), /\{t\.action\}/);
  const page = readFileSync(join(root, "components/PackagePage.tsx"), "utf8");
  assert.equal((page.match(/\{tier\.action\}/g) ?? []).length, 2, "both tier-page CTA branches should read tier.action");
});
