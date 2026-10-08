import assert from "node:assert/strict";
import { test } from "node:test";

import { PAGE, PARALLEL_PAGES, selectAll, selectAllCounted } from "./page.ts";

/**
 * `selectAll` is the loop under the paid report, the placement count and both
 * spend ceilings, and every way it can fail is silent: it returns a short list
 * that looks exactly like a complete one.
 *
 * The case that matters is a server whose `db-max-rows` is below `PAGE`. That
 * is a project setting nothing in this repo can read, so it was carried as an
 * open question rather than a fact, and the old loop - stop on the first page
 * shorter than `PAGE` - was correct only if the answer was "at least 1000".
 * These fake a server at several ceilings so the question does not need an
 * answer.
 */

/** A fake PostgREST that holds `total` rows and never returns more than `cap`. */
function server(total: number, cap: number) {
  let requests = 0;
  const page = (from: number, to: number) => {
    requests += 1;
    const want = Math.min(to - from + 1, cap);
    const rows: { id: number }[] = [];
    for (let i = from; i < Math.min(from + want, total); i++) rows.push({ id: i });
    return Promise.resolve({ data: rows, error: null });
  };
  return { page, requests: () => requests };
}

test("reads every row when the server's ceiling is below the page size", async () => {
  // The old loop returned 500 here and called it the whole table.
  const s = server(1200, 500);
  const rows = await selectAll<{ id: number }>(s.page);
  assert.equal(rows.length, 1200);
  assert.deepEqual(
    rows.map((r) => r.id),
    Array.from({ length: 1200 }, (_, i) => i),
  );
});

test("reads every row at the default ceiling", async () => {
  const s = server(2500, PAGE);
  const rows = await selectAll<{ id: number }>(s.page);
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, 0);
  assert.equal(rows[2499].id, 2499);
});

test("a table that is an exact multiple of the page size does not stop early", async () => {
  const s = server(PAGE * 2, PAGE);
  const rows = await selectAll<{ id: number }>(s.page);
  assert.equal(rows.length, PAGE * 2);
});

test("no row is read twice and none is skipped across pages", async () => {
  const s = server(1337, 300);
  const rows = await selectAll<{ id: number }>(s.page);
  assert.equal(new Set(rows.map((r) => r.id)).size, 1337);
});

test("an empty table costs one request and returns nothing", async () => {
  const s = server(0, PAGE);
  assert.deepEqual(await selectAll(s.page), []);
  assert.equal(s.requests(), 1);
});

test("a short table costs the read plus the one that proves the end", async () => {
  const s = server(12, PAGE);
  const rows = await selectAll<{ id: number }>(s.page);
  assert.equal(rows.length, 12);
  assert.equal(s.requests(), 2);
});

test("a null data field is treated as the end, not as a crash", async () => {
  const rows = await selectAll(() => Promise.resolve({ data: null, error: null }));
  assert.deepEqual(rows, []);
});

test("an error throws rather than returning a short list", async () => {
  await assert.rejects(
    () => selectAll(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    /boom/,
  );
});

test("an error on a later page throws rather than returning the pages before it", async () => {
  // The failure mode this guards: a mid-read error swallowed into a partial
  // list is a truncated report that nothing on the page says is truncated.
  let calls = 0;
  await assert.rejects(
    () =>
      selectAll<{ id: number }>((from) => {
        calls += 1;
        if (calls > 1) return Promise.resolve({ data: null, error: { message: "gone" } });
        const rows = Array.from({ length: PAGE }, (_, i) => ({ id: from + i }));
        return Promise.resolve({ data: rows, error: null });
      }),
    /gone/,
  );
});

/**
 * `selectAllCounted` (8 Oct 2026, audit perf-3 and perf-1): the dashboard's
 * answers read, whose pages used to go out one after another. The same fake
 * server, with the exact count PostgREST sends when asked and a clock on how
 * many requests are in flight at once.
 */
function countedServer(total: number, cap: number, opts: { noCount?: boolean } = {}) {
  let rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  let requests = 0;
  let inflight = 0;
  let peak = 0;
  const page = async (from: number, to: number, count: boolean) => {
    requests += 1;
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 1));
    inflight -= 1;
    const want = Math.min(to - from + 1, cap);
    return { data: rows.slice(from, from + want), error: null, count: count && !opts.noCount ? rows.length : null };
  };
  return {
    page,
    requests: () => requests,
    peak: () => peak,
    /** A row written ahead of every other in id order, as a random uuid can be. */
    insertFirst: () => {
      rows = [{ id: -rows.length }, ...rows];
    },
  };
}

test("counted: every row, in order, with no request spent proving the end", async () => {
  const s = countedServer(2500, PAGE);
  const rows = await selectAllCounted<{ id: number }>(s.page);
  assert.deepEqual(
    rows.map((r) => r.id),
    Array.from({ length: 2500 }, (_, i) => i),
  );
  assert.equal(s.requests(), 3, "three pages, and the count says there is no fourth");
});

test("counted: a server ceiling below the page size is still read whole", async () => {
  const s = countedServer(1200, 500);
  const rows = await selectAllCounted<{ id: number }>(s.page);
  assert.deepEqual(
    rows.map((r) => r.id),
    Array.from({ length: 1200 }, (_, i) => i),
  );
  assert.equal(s.requests(), 3);
});

test("counted: an exact multiple of the page, a short table and an empty one", async () => {
  const two = countedServer(PAGE * 2, PAGE);
  assert.equal((await selectAllCounted(two.page)).length, PAGE * 2);
  assert.equal(two.requests(), 2);
  const short = countedServer(12, PAGE);
  assert.equal((await selectAllCounted(short.page)).length, 12);
  assert.equal(short.requests(), 1, "one request, where selectAll spends two");
  const none = countedServer(0, PAGE);
  assert.deepEqual(await selectAllCounted(none.page), []);
  assert.equal(none.requests(), 1);
});

test("counted: the pages after the first go out together, never more than PARALLEL_PAGES at once", async () => {
  // 12,000 rows is the default Overview for a full-size client: 28 days and the 28 before, 50 prompts, 4 engines.
  const s = countedServer(12_000, PAGE);
  const rows = await selectAllCounted<{ id: number }>(s.page);
  assert.equal(rows.length, 12_000);
  assert.equal(new Set(rows.map((r) => r.id)).size, 12_000, "no row twice");
  assert.equal(s.requests(), 12);
  assert.ok(s.peak() > 1, "the pages went out one after another");
  assert.ok(s.peak() <= PARALLEL_PAGES, `${s.peak()} requests in flight`);
  const one = countedServer(12_000, PAGE);
  await selectAllCounted(one.page, 1);
  assert.equal(one.peak(), 1, "parallel 1 is the old sequential read");
});

test("counted: rows that move during the read are read again, not returned twice or short", async () => {
  const s = countedServer(2500, PAGE);
  let calls = 0;
  const rows = await selectAllCounted<{ id: number }>(async (from, to, count) => {
    calls += 1;
    const r = await s.page(from, to, count);
    // The morning run writes a row once the first page and its count are back.
    if (calls === 1) s.insertFirst();
    return r;
  });
  assert.equal(rows.length, 2501, "the row written mid-read is in, and nothing is doubled");
  assert.equal(new Set(rows.map((r) => r.id)).size, 2501);
});

test("counted: a server that sends no count is read the sequential way", async () => {
  const s = countedServer(2500, PAGE, { noCount: true });
  const rows = await selectAllCounted<{ id: number }>(s.page);
  assert.equal(rows.length, 2500);
});

test("counted: an error on any page throws rather than returning the pages before it", async () => {
  await assert.rejects(
    () => selectAllCounted(() => Promise.resolve({ data: null, error: { message: "boom" }, count: null })),
    /boom/,
  );
  await assert.rejects(
    () =>
      selectAllCounted<{ id: number }>((from, _to, count) =>
        from >= PAGE * 2
          ? Promise.resolve({ data: null, error: { message: "gone" }, count: null })
          : Promise.resolve({ data: Array.from({ length: PAGE }, (_, i) => ({ id: from + i })), error: null, count: count ? PAGE * 5 : null }),
      ),
    /gone/,
  );
});
