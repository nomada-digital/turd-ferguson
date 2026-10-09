import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A small stand-in for the supabase-js query builder, for run-health.test.mts
 * and rerun.test.mts (9 Oct 2026). It holds rows in memory and answers the
 * calls those modules make, with the two server behaviours they exist for:
 *
 * - **db-max-rows.** PostgREST answers any select with at most this many rows
 *   (1000 on a default project) and says so nowhere; a ranged select gets its
 *   range, cut to the same ceiling. An unpaged read over more rows than that
 *   comes back short here exactly as it does in production.
 * - **the run-health claim's unique index** (20261009000000): a second
 *   run_health_mail row for one props.day fails with 23505.
 *
 * Nothing here reaches a database. Every call is logged so a test can say
 * what was read and written. Not a `.test.mts`, so the runner does not run
 * it on its own; the source walks read `.ts` and `.tsx` only.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type Call = { table: string; op: "select" | "insert" | "update"; range: [number, number] | null; rows: number };

export function fakeDb(tables: Tables, opts: { maxRows?: number; failInsert?: (table: string, row: Row) => boolean } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  let nextId = 1;
  const calls: Call[] = [];

  /**
   * A column, or a JSON path as PostgREST reads it: `col->key` is the value
   * (null when absent), and a last `->>key` is its text (or null).
   */
  const get = (r: Row, c: string): unknown => {
    const m = /^(\w+)((?:->\w+)*)(?:->>(\w+))?$/.exec(c);
    if (!m || (!m[2] && !m[3])) return r[c];
    let v: unknown = r[m[1]!];
    for (const key of m[2]!.split("->").filter(Boolean)) v = v && typeof v === "object" ? (v as Row)[key] : undefined;
    if (!m[3]) return v ?? null;
    v = v && typeof v === "object" ? (v as Row)[m[3]] : undefined;
    return v === undefined || v === null ? null : String(v);
  };

  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const q = {
      op: "select" as Call["op"],
      cols: null as string | null,
      returning: false,
      row: null as Row | null,
      patch: null as Row | null,
      orderBy: null as [string, boolean] | null,
      lim: null as number | null,
      rng: null as [number, number] | null,
      one: null as "one" | "maybe" | null,
    };
    const pick = (r: Row) => (q.cols ? Object.fromEntries(q.cols.split(",").map((c) => [c.trim(), r[c.trim()] ?? null])) : { ...r });
    const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
      const rows = (tables[table] ??= []);
      if (q.op === "insert") {
        if (opts.failInsert?.(table, q.row!)) return { data: null, error: { message: `${table} insert refused by the test` } };
        const row: Row = { id: nextId++, ...q.row };
        if (
          table === "dashboard_events" &&
          row.event === "run_health_mail" &&
          rows.some((r) => r.event === "run_health_mail" && get(r, "props->>day") === get(row, "props->>day"))
        ) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "dashboard_events_run_health_once"' } };
        }
        rows.push(row);
        calls.push({ table, op: "insert", range: null, rows: 1 });
        const out = q.returning ? pick(row) : null;
        return { data: q.one ? out : out ? [out] : null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (q.op === "update") {
        for (const r of hit) Object.assign(r, q.patch);
        calls.push({ table, op: "update", range: null, rows: hit.length });
        return { data: q.returning ? hit.map(pick) : null, error: null };
      }
      let out = hit;
      if (q.orderBy) {
        const [c, asc] = q.orderBy;
        out = [...out].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : String(a[c]) > String(z[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (q.rng) out = out.slice(q.rng[0], Math.min(q.rng[1] + 1, q.rng[0] + maxRows));
      else out = out.slice(0, maxRows);
      if (q.lim !== null) out = out.slice(0, q.lim);
      calls.push({ table, op: "select", range: q.rng, rows: out.length });
      const picked = out.map(pick);
      if (q.one === "maybe") return { data: picked[0] ?? null, error: null };
      if (q.one === "one") return picked.length === 1 ? { data: picked[0], error: null } : { data: null, error: { message: "not one row" } };
      return { data: picked, error: null };
    };
    const b = {
      select(cols?: string) {
        if (q.op === "select") q.cols = cols ?? null;
        else {
          q.returning = true;
          q.cols = cols ?? null;
        }
        return b;
      },
      insert(row: Row) {
        q.op = "insert";
        q.row = row;
        return b;
      },
      update(patch: Row) {
        q.op = "update";
        q.patch = patch;
        return b;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => get(r, c) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(get(r, c))), b),
      is: (c: string, v: unknown) => (filters.push((r) => (get(r, c) ?? null) === v), b),
      lt: (c: string, v: string) => (filters.push((r) => get(r, c) != null && String(get(r, c)) < v), b),
      gte: (c: string, v: string) => (filters.push((r) => String(get(r, c)) >= v), b),
      lte: (c: string, v: string) => (filters.push((r) => String(get(r, c)) <= v), b),
      order: (c: string, o: { ascending?: boolean } = {}) => ((q.orderBy = [c, o.ascending !== false]), b),
      limit: (n: number) => ((q.lim = n), b),
      range: (lo: number, hi: number) => ((q.rng = [lo, hi]), b),
      single: () => ((q.one = "one"), b),
      maybeSingle: () => ((q.one = "maybe"), b),
      then(resolve: (v: ReturnType<typeof run>) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, tables, calls };
}
