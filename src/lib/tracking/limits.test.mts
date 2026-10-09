/**
 * C2 of docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep
 * 2026): alwaystracked's limits on the server. One test per refusal, then the
 * census that every insert into tracked_questions, tracked_keywords and
 * tracked_clusters goes through limits.ts.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ANGLES, angleFor, clusterLimitFor, promptRoom, refuseCluster, refuseEdit, refuseGrouping, refuseKeyword, refusePrompts } from "./limits.ts";

test("clusters: refused at cluster_limit live, allowed under it", () => {
  assert.equal(refuseCluster(9, 10), null);
  assert.match(refuseCluster(10, 10) ?? "", /limit of 10 clusters/);
  assert.match(refuseCluster(11, 10) ?? "", /limit/);
  assert.equal(refuseCluster(14, 15), null, "one pack: 15");
});

test("prompts: refused when the cluster already has 5 live", () => {
  assert.equal(refusePrompts({ clientLive: 4, clusterLive: 4, clusterLimit: 10 }), null);
  assert.match(refusePrompts({ clientLive: 5, clusterLive: 5, clusterLimit: 10 }) ?? "", /5 of 5/);
  assert.match(refusePrompts({ clientLive: 3, clusterLive: 3, clusterLimit: 10 }, 3) ?? "", /already has 3 of 5/, "a batch that overflows the cluster");
});

test("prompts: ungrouped ones count against the client's 5 per cluster (R111: 5 grouped + 9 ungrouped is fine)", () => {
  assert.equal(refusePrompts({ clientLive: 5, clusterLive: null, clusterLimit: 10 }, 9), null);
  assert.equal(refusePrompts({ clientLive: 49, clusterLive: null, clusterLimit: 10 }), null);
  assert.match(refusePrompts({ clientLive: 50, clusterLive: null, clusterLimit: 10 }) ?? "", /limit of 50 prompts/);
  assert.equal(promptRoom({ clientLive: 46, clusterLive: null, clusterLimit: 10 }), 4);
  assert.equal(promptRoom({ clientLive: 10, clusterLive: 3, clusterLimit: 10 }), 2);
  assert.equal(promptRoom({ clientLive: 60, clusterLive: null, clusterLimit: 10 }), 0, "never negative");
});

test("keywords: refused when the cluster already has one live, or at one per cluster", () => {
  assert.equal(refuseKeyword({ clientLive: 0, clusterHasLive: false, clusterLimit: 10 }), null);
  assert.match(refuseKeyword({ clientLive: 1, clusterHasLive: true, clusterLimit: 10 }) ?? "", /already has its keyword/);
  assert.equal(refuseKeyword({ clientLive: 9, clusterHasLive: null, clusterLimit: 10 }), null);
  assert.match(refuseKeyword({ clientLive: 10, clusterHasLive: null, clusterLimit: 10 }) ?? "", /limit of 10 keywords/);
});

test("editing: text is refused once any reading exists", () => {
  assert.equal(refuseEdit(0), null);
  assert.match(refuseEdit(1) ?? "", /Stop it and add a new one/);
});

// C3 grouping, and R111 (Danny, 29 Sep 2026): 14 prompts as 5+5+4, or 5 grouped + 9 ungrouped.
const fourteen = Array.from({ length: 14 }, (_, i) => `p${i}`);

/** Group in turn, as admin does: each batch is judged against what is still ungrouped. */
function groupInTurn(batches: string[][]): (string | null)[] {
  const ungrouped = new Set(fourteen);
  return batches.map((ids) => {
    const refused = refuseGrouping({ ids, ungrouped, clusterLive: 0 });
    if (!refused) ids.forEach((id) => ungrouped.delete(id));
    return refused;
  });
}

test("grouping (R111): 14 prompts as clusters of 5, 5 and 4 with none left over", () => {
  assert.deepEqual(groupInTurn([fourteen.slice(0, 5), fourteen.slice(5, 10), fourteen.slice(10)]), [null, null, null]);
});

test("grouping (R111): 5 grouped and 9 left ungrouped is allowed, and the 9 still fit the client's allowance", () => {
  assert.deepEqual(groupInTurn([fourteen.slice(0, 5)]), [null]);
  assert.equal(refusePrompts({ clientLive: 14, clusterLive: null, clusterLimit: 10 }), null, "the ungrouped 9 are live prompts, counted, not refused");
});

test("grouping: refused past 5 in a cluster, for a prompt already grouped, twice, or none", () => {
  const ungrouped = new Set(fourteen);
  assert.match(refuseGrouping({ ids: fourteen.slice(0, 6), ungrouped, clusterLive: 0 }) ?? "", /pass 5/);
  assert.match(refuseGrouping({ ids: ["p0", "p1"], ungrouped, clusterLive: 4 }) ?? "", /has 4 live/);
  assert.match(refuseGrouping({ ids: ["elsewhere"], ungrouped, clusterLive: 0 }) ?? "", /ungrouped/);
  assert.match(refuseGrouping({ ids: ["p0", "p0"], ungrouped, clusterLive: 0 }) ?? "", /twice/);
  assert.match(refuseGrouping({ ids: [], ungrouped, clusterLive: 0 }) ?? "", /at least one/);
  assert.match(groupInTurn([fourteen.slice(0, 5), fourteen.slice(3, 8)])[1] ?? "", /ungrouped/, "a prompt in one cluster is not grouped again");
});

test("grouping (R111): the daily runner reads prompts by client, never by cluster, so ungrouped ones still get readings", () => {
  // 9 Oct 2026 (audit reliability-2): the dispatch's live-prompt count moved
  // from runner.ts to run-health.ts readTrackable, paged, which the dispatch
  // and the run-health readings share. Same two reads, one file further.
  const src = ["./runner.ts", "./run-health.ts"].map((f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8")).join("\n");
  const reads = [...src.matchAll(/\.from\("tracked_questions"\)[^;]*/g)].map((m) => m[0]);
  assert.ok(reads.length >= 2, `found ${reads.length} tracked_questions reads in runner.ts and run-health.ts, floor 2`);
  for (const r of reads) assert.doesNotMatch(r, /cluster_id/, r);
});

test("angles: a scan kind is its angle, anything else is none", () => {
  for (const a of ANGLES) assert.equal(angleFor(a), a);
  assert.equal(angleFor("informational"), null);
  assert.equal(angleFor(null), null);
});

test("the pack: cluster_limit = 10 + 5 per pack", () => {
  assert.equal(clusterLimitFor(0), 10);
  assert.equal(clusterLimitFor(1), 15);
  assert.equal(clusterLimitFor(3), 25);
  assert.equal(clusterLimitFor(-1), 10);
  assert.equal(clusterLimitFor(Number.NaN), 10);
});

// ---- The census. ----

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const TABLES = ["tracked_questions", "tracked_keywords", "tracked_clusters"];
const HOME = "src/lib/tracking/limits.ts";
/** `.from(` chains walked across src. 29 Sep 2026: 165. */
const FLOOR = 150;

function walk(dir: string): string[] {
  const st = statSync(dir);
  if (!st.isDirectory()) return [dir];
  return readdirSync(dir).flatMap((f) => walk(join(dir, f)));
}

/**
 * Every write chain that could land in one of the three tables: a `.from()`
 * of one of them followed by insert/upsert before the statement ends, or a
 * `.from(variable)` insert in a file that names one of them at all - the
 * indirection the old admin action used.
 */
export function strayWrites(source: string): string[] {
  const out: string[] = [];
  const namesTable = TABLES.some((t) => source.includes(`"${t}"`));
  for (const m of source.matchAll(/\.from\(\s*([^)]*?)\s*\)([^;]*)/g)) {
    if (!/\.(insert|upsert)\(/.test(m[2])) continue;
    const arg = m[1];
    const literal = /^["'`]([a-z_]+)["'`]$/.exec(arg)?.[1];
    if (literal ? TABLES.includes(literal) : namesTable) out.push(arg);
  }
  return out;
}

function chains(): { file: string; source: string; count: number }[] {
  return walk(join(ROOT, "src"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.m?ts$/.test(f))
    .map((f) => {
      const source = readFileSync(f, "utf8");
      return { file: relative(ROOT, f), source, count: [...source.matchAll(/\.from\(/g)].length };
    });
}

test("census: every insert into the three tracked tables goes through limits.ts", () => {
  const files = chains();
  const walked = files.reduce((n, f) => n + f.count, 0);
  assert.ok(walked >= FLOOR, `walked ${walked} .from( chains, floor ${FLOOR} - the walk has stopped matching`);
  const stray = files.filter((f) => f.file !== HOME).flatMap((f) => strayWrites(f.source).map((a) => `${f.file}: .from(${a})`));
  assert.deepEqual(stray, [], "write to a tracked table outside limits.ts");
  assert.equal(strayWrites(readFileSync(join(ROOT, HOME), "utf8")).length, 3, "limits.ts holds the three writers");
});

test("census probe: a direct insert and a variable-table insert both fire", () => {
  assert.deepEqual(strayWrites(`await db.from("tracked_questions").insert(rows);`), ['"tracked_questions"']);
  assert.deepEqual(strayWrites(`const t = "tracked_keywords";\nawait db.from(t).insert({ keyword });`), ["t"]);
  assert.deepEqual(strayWrites(`await db.from("tracked_clusters")\n  .upsert(row, { onConflict: "id" })\n  .select("id");`), ['"tracked_clusters"']);
  assert.deepEqual(strayWrites(`await db.from("tracked_questions").select("id").eq("x", 1);`), [], "a read is not a write");
  assert.deepEqual(strayWrites(`await db.from("scan_questions").insert(rows);`), [], "another table");
});
