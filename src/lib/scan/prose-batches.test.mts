import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PROSE_BATCH_CHARS, batchBlocks, runBatches } from "./prose-batches.ts";

/**
 * 8 Oct 2026 (review of audit reliability-1 / data-6): which tracking answers
 * are stored brands_ok=false is decided by which blocks a failed batch held,
 * by their index in what the caller handed over. That ran only inside
 * anthropic.ts, which node --test cannot load, and decide.test.mts's stand-in
 * extractor computed failedBlocks itself - so a change that numbered the
 * blocks after dropping blanks would have marked the wrong answers with every
 * test green. These run the code extractBrands runs.
 */

const at = (batches: { at: number }[][]) => batches.map((b) => b.map((x) => x.at));

test("indices are the caller's, taken before blank answers are dropped", () => {
  const batches = batchBlocks(["first", "   ", "", "fourth", "\n\t", "sixth"]);
  assert.deepEqual(at(batches), [[0, 3, 5]]);
  assert.deepEqual(batches[0]!.map((b) => b.text), ["first", "fourth", "sixth"]);
  assert.deepEqual(batchBlocks(["", "  "]), [], "nothing to read is no batch, not an empty one");
});

test("a batch falls between two answers, and an over-long answer is clamped to a whole batch and keeps its index", () => {
  const max = 10;
  const batches = batchBlocks(["aaaa", "", "bbbb", "cccc", "x".repeat(25), "dd"], max);
  assert.deepEqual(at(batches), [[0, 2], [3], [4], [5]]);
  assert.equal(batches[2]![0]!.text, "x".repeat(max), "clamped to one batch, not split across two");
  assert.ok(batches.every((b) => b.reduce((n, x) => n + x.text.length, 0) <= max));
  assert.equal(batchBlocks(["y".repeat(PROSE_BATCH_CHARS + 1)])[0]![0]!.text.length, PROSE_BATCH_CHARS, "the default is PROSE_BATCH_CHARS");
});

test("a failed batch reports its own answers' indices, the first failure's reason, and the batches that landed", async () => {
  const max = 10;
  // Batches: [0, 2] (4 + 4), [3] (8 + 7 > 10 starts one), [5] (7 + 5 > 10), with blanks at 1 and 4.
  const batches = batchBlocks(["aaaa", " ", "bbbb", "ccccccc", "", "ddddd"], max);
  assert.deepEqual(at(batches), [[0, 2], [3], [5]]);
  const sent: string[][] = [];
  const out = await runBatches(
    batches,
    async (texts) => {
      sent.push(texts);
      if (texts.includes("ccccccc")) throw Object.assign(new Error("Overloaded"), { status: 529 });
      if (texts.includes("ddddd")) throw new Error("second failure");
      return texts.map((t) => `Rival of ${t}`);
    },
    (err) => `described: ${(err as Error).message}`,
  );
  assert.deepEqual(sent, [["aaaa", "bbbb"], ["ccccccc"], ["ddddd"]], "one request per batch, in order, after one fails");
  assert.deepEqual(out, { items: ["Rival of aaaa", "Rival of bbbb"], failedBatches: 2, failedBlocks: [3, 5], error: "described: Overloaded" });
});

test("no failure: no failedBlocks and no error key", async () => {
  const out = await runBatches(batchBlocks(["a", "b"]), async (texts) => texts, () => "never");
  assert.deepEqual(out, { items: ["a", "b"], failedBatches: 0, failedBlocks: [] });
});

test("extractBrands batches through this module and keeps no copy of the bookkeeping", () => {
  const src = readFileSync(new URL("./anthropic.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ batchBlocks, runBatches \} from "\.\/prose-batches";/);
  assert.match(src, /const batches = batchBlocks\(blocks\);/);
  assert.match(src, /await runBatches\(\s*batches,/);
  assert.ok(!/PROSE_BATCH_CHARS\s*=/.test(src), "the batch size lives here, once");
  assert.ok(!/failedBlocks\.push\(/.test(src), "the failed-index map lives here, once");
});
