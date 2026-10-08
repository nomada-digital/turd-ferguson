/**
 * PostgREST answers a select with at most `db-max-rows` rows - 1000 on a
 * default Supabase project - and says so nowhere in the response. A truncated
 * answer and a genuinely short one are the same shape, so an unpaged select
 * over a table that grows with the scan reads as complete when it is not.
 *
 * The retention purge hit this first and it cleared the first thousand stale
 * scans and silently left the rest. The same ceiling sits under the per-scan
 * reads: citations are questions x engines x however many sources each answer
 * cited, which is the one table on a scan that has no small bound.
 *
 * Pass a page function rather than a builder so the caller keeps its own
 * filters and its own row type:
 *
 *     await selectAll((from, to) =>
 *       db.from("scan_citations").select("source_domain")
 *         .eq("scan_id", scanId)
 *         .order("id", { ascending: true })
 *         .range(from, to));
 *
 * Always order by the primary key. `range` is `offset` and `limit`, so without
 * an ORDER BY the order between two requests is whatever the planner chose and
 * a row can land on both pages or on neither.
 *
 * No `server-only` import, deliberately. This module holds no secret and
 * reaches nothing - it loops over a function the caller supplies - and the
 * guard that matters sits on `supabase/admin.ts`, which is what actually
 * builds the service-role client and which every caller of this goes through.
 * What the guard here did buy was that `node --test` could not load the file,
 * so the loop under the paid report and both spend ceilings could not have a
 * check on it. It has one now.
 */
export const PAGE = 1000;

/**
 * Read a whole table through a paged select, whatever the server's own row
 * ceiling is set to.
 *
 * The end of the table is a page that comes back empty, and the next offset is
 * however many rows the last page actually returned.
 *
 * It used to stop on the first page shorter than `PAGE`, which is only sound
 * if `db-max-rows` is at least `PAGE`. That is the Supabase default and it is
 * a project setting, changeable in the dashboard, readable only with the
 * dashboard or the service role key - so nothing in this repo could confirm
 * the assumption the paid report rested on, and it sat in blocked.md as a
 * question for Danny. Lowered to 500 and the old loop returns the first 500
 * citations of a scan as the whole set: the source list, share of voice, the
 * placement table and both spend ceilings all quietly read short, and the day
 * the ceilings under-report is the busy day they exist for.
 *
 * Advancing by what came back rather than by `PAGE` removes the assumption
 * instead of documenting it. The cost is one extra request per call - the
 * empty page that proves the end - which is paid on every call rather than
 * only on the truncated ones, because a short page cannot be told from a
 * capped one without asking. Callers run these inside `Promise.all`, so it is
 * one round trip added to a group, not one per table.
 */
export async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    // An empty page is the end of the table, and the only thing that is.
    if (!rows.length) return out;
    out.push(...rows);
    // Never by PAGE: the server may have given fewer than were asked for, and
    // the next offset is where this page actually ended. A row count is always
    // at least 1 here, so the offset strictly increases and the loop ends.
    from += rows.length;
  }
}

/**
 * How many pages `selectAllCounted` has in flight at once. Six keeps one
 * dashboard read to a handful of PostgREST requests at a time, with the page's
 * other reads beside it, while a full year of one client (73 pages) is about
 * a dozen round trips rather than 73.
 */
export const PARALLEL_PAGES = 6;

/**
 * Every row of a paged select, with the pages after the first read side by
 * side instead of one after another (8 Oct 2026, audit perf-3 and perf-1).
 *
 * The dashboard's answers are days x prompts x engines: 11,200 rows for a
 * full-size alwaystracked client on the default 28 days and the 28 before, so
 * twelve pages, and no page was asked for until the one before it had come
 * back. Every page is a round trip from the function to the database, so the
 * read's wall time grew with the client and with the range, and Reports - all
 * of a client's history - grew every day.
 *
 * The first page also asks for an exact count, which PostgREST answers from
 * the same statement. Every remaining offset is then known, and they go out
 * `parallel` at a time. Offsets advance by what the first page actually held,
 * not by PAGE, so a server whose `db-max-rows` is below PAGE is still read
 * whole, as `selectAll` reads it. The request that proves the end still goes
 * out, as below, but beside the pages rather than after them.
 *
 * Rows that move during the read - the morning run writing answers between
 * two requests - shift every later offset by one, so the read is done again
 * with `selectAll` when it sees that. It sees it in two ways: a page holding a
 * different number of rows than the count promised, or any row at all at
 * offset `total`, which one more request asks for, issued last in the batch.
 * The second is needed (review, 8 Oct 2026): answer ids are random uuids, so a
 * new row lands anywhere in id order and pushes every later row along by one.
 * Every page then stays full, and when `total` is a multiple of the page size
 * the last one is full too, so a size check alone returned a row twice and
 * dropped another. A server that sends no count is also read with `selectAll`.
 *
 * What this does not catch: a write that lands after the end probe has read
 * but before a page still in flight beside it does - a window about one
 * request wide - and a write during the sequential re-read, which can read a
 * row twice as `selectAll`, and the old one-after-another read, always could.
 */
export async function selectAllCounted<T>(
  page: (
    from: number,
    to: number,
    count: boolean,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>,
  parallel: number = PARALLEL_PAGES,
): Promise<T[]> {
  const again = () => selectAll<T>((from, to) => page(from, to, false));
  const first = await page(0, PAGE - 1, true);
  if (first.error) throw new Error(first.error.message);
  const head = first.data ?? [];
  const total = first.count;
  if (typeof total !== "number") return again();
  if (head.length >= total) return head;
  // Rows the count promised and the page did not hold: no page size to step by.
  if (!head.length) return again();

  const step = head.length;
  const offsets: number[] = [];
  for (let at = step; at < total; at += step) offsets.push(at);
  // The end probe: one row at `total`, last in the list so it is asked for after every page is.
  offsets.push(total);
  const pages: T[][] = new Array(offsets.length);
  let next = 0;
  let moved = false;
  const worker = async () => {
    while (next < offsets.length) {
      const i = next++;
      const at = offsets[i];
      const end = at >= total;
      const { data, error } = await page(at, end ? at : at + step - 1, false);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      if (rows.length !== (end ? 0 : Math.min(step, total - at))) moved = true;
      pages[i] = end ? [] : rows;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, offsets.length)) }, worker));
  if (moved) return again();
  return head.concat(...pages);
}
