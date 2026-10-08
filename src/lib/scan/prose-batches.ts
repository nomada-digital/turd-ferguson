/**
 * How brand extraction cuts an engine's answers into requests, and which
 * answers a failed request leaves unread.
 *
 * Split out of `anthropic.ts` (8 Oct 2026, review of audit reliability-1 /
 * data-6) for the reason `retry-policy.ts` and `prose.ts` were: that file opens
 * with `import "server-only"` and pulls in the SDK, so `node --test` cannot load
 * it. Which tracking answers are stored `brands_ok=false` is decided here - a
 * failed batch's blocks, by their index in what the caller handed over - and
 * the indices are taken before blank answers are dropped and long ones are
 * clamped. A change that numbered them after would mark the wrong answers,
 * and with the producer unloadable every test stayed green. This file imports
 * nothing, so `prose-batches.test.mts` runs the real thing.
 */

/**
 * Answers per request, by length of prose.
 *
 * This used to be one call for every answer an engine gave, joined into a
 * single string and cut at 120,000 characters. Both halves of that were the
 * shape the source classifier was already fixed for: the input grew with the
 * scan rather than with the batch, and the cut fell at the end of the joined
 * string, so what it dropped was whole later answers - the last questions
 * asked simply had no brands extracted from them and nothing said so.
 *
 * The output ceiling was the worse half. It was a flat 8,000 tokens against
 * an input that scaled with the scan, and unlike the classifier this call is
 * NOT wrapped in "never fatal": a truncated response fails the schema parse,
 * which threw out of Promise.all, which failed the whole run - after every
 * engine read on it had already been paid for.
 */
export const PROSE_BATCH_CHARS = 60_000;

/** One answer in a batch: `at` is its index in the blocks the caller handed over. */
export type ProseBlock = { at: number; text: string };

/**
 * The blocks, trimmed, blanks dropped, cut into batches of at most `max`
 * characters that fall between two answers rather than through one.
 *
 * One answer is clamped to a whole batch rather than to some smaller share
 * of one, so nothing is cut tighter here than the old 120,000-character cut
 * would have cut it. 60,000 characters is some 15,000 words from a single
 * engine answer; the clamp is a bound on the pathological case, not a size
 * any answer in this pipeline is expected to reach.
 */
export function batchBlocks(blocks: readonly string[], max: number = PROSE_BATCH_CHARS): ProseBlock[][] {
  const usable = blocks
    .map((b, at) => ({ at, text: b.trim() }))
    .filter((b) => b.text)
    .map((b) => (b.text.length > max ? { at: b.at, text: b.text.slice(0, max) } : b));

  const batches: ProseBlock[][] = [];
  let current: ProseBlock[] = [];
  let size = 0;
  for (const block of usable) {
    if (current.length && size + block.text.length > max) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Each batch through `run`, one after another. A batch that throws is counted
 * and its blocks' indices are returned in `failedBlocks`, so a caller can retry
 * those answers and mark the ones still unread; `error` is the first failure as
 * `describe` words it. One bad batch must not cost the scan its leaderboard,
 * and must not cost it the engine reads already paid for.
 */
export async function runBatches<T>(
  batches: readonly ProseBlock[][],
  run: (texts: string[]) => Promise<T[]>,
  describe: (err: unknown) => string,
): Promise<{ items: T[]; failedBatches: number; failedBlocks: number[]; error?: string }> {
  const items: T[] = [];
  let failedBatches = 0;
  const failedBlocks: number[] = [];
  let error: string | undefined;
  for (const batch of batches) {
    try {
      items.push(...(await run(batch.map((b) => b.text))));
    } catch (err) {
      failedBatches += 1;
      failedBlocks.push(...batch.map((b) => b.at));
      error ??= describe(err);
      console.warn("[scan] a prose batch failed to extract:", err instanceof Error ? err.message : err);
    }
  }
  return { items, failedBatches, failedBlocks, ...(error ? { error } : {}) };
}
