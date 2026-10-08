/**
 * /app/[client] page census (R146 part 2, BRIEF-4 P6; Danny, 30 Sep 2026,
 * danny.md line 134). Walks every page.tsx under src/app/app/[client]/ and
 * holds, for each one:
 *  (a) noindex in its own metadata, as well as the layout's (the header rule
 *      and robots.txt are route-closure.test.mts's);
 *  (b) no session is a redirect to /app/login, never a render;
 *  (c) the membership 404: the client is found only among the session's own
 *      clients, and a slug that is not one of them is notFound();
 *  (d) every query key the page reads is registered below with the line in the
 *      page that bounds it - a whitelist, a match against this client's own
 *      rows, a clamp, or a named reader whose own test owns the bound. A new
 *      key, or a bound that stops being in the file, fails;
 *  (e) a page that hands the whole query to a helper names that helper in
 *      READERS, so no key is read where this census cannot see it.
 * Write affordances are role-gated in the routes (spend-gates, route-callers,
 * refuseRole); a page's own role reads are held under (f).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLIENT = join(ROOT, "src", "app", "app", "[client]");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** "" for the overview, "/named", "/clusters/[cluster]". */
const PAGES = new Map(
  walk(CLIENT)
    .filter((f) => /[\\/]page\.tsx$/.test(f))
    .map((f) => {
      const segs = relative(CLIENT, f).split(sep).slice(0, -1);
      return [segs.length ? "/" + segs.join("/") : "", readFileSync(f, "utf8")] as const;
    }),
);

/** Helpers a page may hand the whole query to, and the keys each owns, with the test that holds the bound. */
const READERS: Record<string, string> = {
  "rangeFrom(sp,": "from, to, compare - clamped to real days and the three compare modes; overview-data's own test",
  // DS38, 2 Oct 2026 (R173 pass 4): the nav's links carry the stated range - rangeFrom's own reading, re-serialised.
  "rangeQuery(sp,": "from, to, compare again, through rangeFrom, written back only where stated, for the nav links",
  "placementsScreen(repo, client, sp,": "from, to, cluster - the cluster must be one of this client's; placements-screen's own test",
  "verdictFromQuery(one,": "the Check keyword verdict, read back only as a whole verdict; add-cluster's own test, and the HMAC in the cluster route",
};

/**
 * Every query key, per page, and a substring of that page that bounds it.
 * Registered 1 Oct 2026 with the routes as built through R145.
 */
const KEYS: Record<string, Record<string, string>> = {
  "": {
    cluster: 'typeof sp.cluster === "string" ? sp.cluster : undefined', // matched against its cards in Overview.tsx, held below
    // 2 Oct 2026, R173 pass 2: the setup route's 303 after Confirm; the line shows only when the confirm reads back.
    setup: 'sp.setup === "confirmed" && confirmed === true',
  },
  "/clusters": {
    filter: 'f === "named" || f === "never" ? f : "all"',
    // "moved" added 2 Oct 2026 (R170 part 2): the /group route's 303 after Move into a cluster.
    // "unselected" added 2 Oct 2026 (DS13, R173 pass 2): the bulk bar posted with nothing ticked or no cluster picked.
    // "rekeyed" added 2 Oct 2026 (R179): the keyword route's 303 after Use this keyword on a pending card.
    done: '(done === "stopped" || done === "undone" || done === "added" || done === "saved" || done === "moved" || done === "refused" || done === "unselected" || done === "rekeyed")',
    kind: '(kind === "prompt" || kind === "cluster")',
    // R151, 3 Oct 2026: the toast also carries `why`'s words, so the recorded line grew; the bound is unchanged.
    id: "? { done, kind, id, count, why:", // a toast only names a row the list already has, or id=selected for a batch
    // DS13, 2 Oct 2026: a bulk stop or move's counts, drawn only beside id=selected and as whole numbers within BULK_MAX.
    ok: "ok >= 0 && ok <= ticked && ticked <= BULK_MAX",
    ticked: "Number.isInteger(ticked)",
    kw: '(one("kw") ?? "").slice(0, 200)',
    add: 'one("add") === "1"',
    sig: '(one("sig") ?? "").slice(0, 64)',
    ask: 'ask === "sent"',
    n: "n > 0 && n <= ASK_ITEMS_MAX",
    of: '(of === "prompts" || of === "keywords")',
    // DS29, 2 Oct 2026: the ask's recipient was `to`, which overwrote the range's `to` on a sent ask from Clusters; now `via`.
    via: 'one("via") === "agency"',
    open: "open={one(\"open\")}", // matched by c.id === openId in Clusters.tsx, nothing is echoed
    q: 'clusterSearch(one("q"))',
    // R179, 2 Oct 2026: Change keyword on a pending card. `rk` is the check route's 303 naming the card (drawn only on
    // the card whose id matches, its verdict rebuilt by verdictFromQuery); `redraft` names the card whose inputs take drafts.
    rk: '(one("rk") ?? "").slice(0, 64)',
    redraft: '(one("redraft") ?? "").slice(0, 64)',
    // DS29, 2 Oct 2026 (R173 pass 2): the hide route's 303 after a recorded "Hide for 30 days"; a flag, nothing echoed.
    hid: 'one("hid") === "1" && !ask',
    // R151, 3 Oct 2026: the prompt route's refusal code; slotRefusal maps it to SLOT_WHY's fixed words, own keys only.
    why: 'slotRefusal(one("why"))',
  },
  "/clusters/[cluster]": {
    prompt: "promptIndex(sp.prompt, detail.card.prompts.length)",
    // R151 (3 Oct 2026): note.ts noteState - NOTE_SAID's own keys only (saved, empty, long, refused).
    note: "noteState(sp.note)",
    engine: "engineTab(sp.engine, engines)",
  },
  "/named": {
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    engine: 'engines.find((e) => e === one("engine"))',
    all: 'one("all") === "1"',
    open: "openKey(sp.open)",
    // DS21, 2 Oct 2026 (R173 pass 2, "lists over 10 rows have search"): the brand search, cut as the Clusters search is.
    q: 'clusterSearch(one("q"))',
  },
  "/cited": {
    cluster: '(data.clusters ?? []).some((c) => c.id === one("cluster"))',
    engine: 'engines.find((e) => e === one("engine"))',
    kind: 'k === "yours" || k === "others" ? k : "all"',
    all: 'one("all") === "1"',
    open: 'openPage(one("open"))',
    // DS20, 2 Oct 2026 (R173 pass 2, "lists over 10 rows have search"): the page search, cut as the Clusters search is.
    q: 'clusterSearch(one("q"))',
  },
  "/reports": {},
  "/settings": {
    ask: 'sp.ask === "sent"',
    via: 'sp.via === "agency"', // DS29, 2 Oct 2026: renamed from `to` with Clusters' (the range's key)
    team: "teamToast(sp.team, sp.who,", // teamToast answers only invited, removed, role or refused
    who: "teamToast(sp.team, sp.who,", // readEmail: trimmed, format-checked, at most EMAIL_MAX
    // R151, 3 Oct 2026: a refusal's code from the member route; teamWhy matches it against TEAM_WHY's keys, nothing is echoed.
    why: "inviteRefusal(sp.team, sp.why)",
    // 8 Oct 2026: the trial route's 303 back - only "cancelled" or "refused" draw a toast, nothing is echoed.
    trial: 'sp.trial === "cancelled"',
  },
  "/placements": {
    type: 'pickKind(typeof sp.type === "string" ? sp.type : null)',
    sel: "screen.view.rows.some((r) => r.id === sp.sel)",
  },
  // 1 Oct 2026, R166 part 3b: the setup page's one key, the confirm route's way back on a failed write.
  "/setup": {
    confirm: 'sp.confirm === "failed"',
    // 2 Oct 2026, R166 part 5: Check keyword on a setup card - the check route's 303 back to that card.
    card: 'cards.find((c) => c.id === one("card"))',
    kw: '(one("kw") ?? "").slice(0, 200)',
    sig: '(one("sig") ?? "").slice(0, 64)',
    // 2 Oct 2026, R179: the keyword route's 303 after Use this keyword - one of two words, on the card `card` names.
    rekey: 'rekey === "rekeyed" ? "Keyword set on this cluster.',
  },
  // 2 Oct 2026, R173 pass 3, DS36: the catch-all reads no key; its query rides only into loginHref's next.
  "/[...rest]": {},
};

/** Role reads on a page, and what each may decide. A page reading a role anywhere else fails. */
const ROLE_READS: Record<string, string[]> = {
  // DS10 (2 Oct 2026): the setup-outstanding line tells a viewer an owner or editor confirms.
  // 8 Oct 2026 (review of 2379757): writes are judged by writeRole(client), which makes an ended client read-only.
  "": ["const canWrite = refuseRole(writeRole(client)) === null;"],
  "/clusters": ["canWrite={refuseRole(writeRole(client)) === null}"],
  "/clusters/[cluster]": ['canWrite={writeRole(client) === "owner" || writeRole(client) === "editor"}'],
  "/settings": ['owner={client.role === "owner"}'],
  // R166 part 3b: viewers see the cards but not Confirm; the route refuses them too.
  "/setup": ["const canWrite = refuseRole(writeRole(client)) === null;"],
};

/**
 * Floors, 1 Oct 2026: 8 pages (overview, clusters, one cluster, placements,
 * and BRIEF-4's named, cited, reports, settings) and 32 registered keys.
 * Raised 1 Oct 2026 (R166 part 3b): 9 pages and 33 keys - /setup and its confirm.
 * Raised 2 Oct 2026 (R166 part 5): 36 keys - /setup's card, kw and sig.
 * Raised 2 Oct 2026 (R173 pass 2): 37 keys - the Overview's setup.
 * Raised 2 Oct 2026 (R173 pass 3, DS36): 10 pages - the [...rest] catch-all.
 * Raised 8 Oct 2026: 38 keys - Settings' trial, the Cancel trial route's way back.
 */
const PAGE_FLOOR = 10;
const KEY_FLOOR = 38;

/** The query keys a page reads by name, as written. */
export function keysRead(src: string): string[] {
  const keys = new Set<string>();
  for (const [, k] of src.matchAll(/\bsp\.(\w+)/g)) keys.add(k!);
  for (const [, k] of src.matchAll(/\bsp\["(\w+)"\]/g)) keys.add(k!);
  for (const [, k] of src.matchAll(/\bone\("(\w+)"\)/g)) keys.add(k!);
  return [...keys].sort();
}

/** Places the whole query object leaves the page, other than `one`'s own body. */
export function queryHandoffs(src: string): string[] {
  return [...src.matchAll(/[\w.]+\([^()]*\bsp\b[,)]/g)].map((m) => m[0]).filter((s) => !Object.keys(READERS).some((r) => s.includes(r.slice(0, -1))));
}

test("census floor: the walk still finds the pages and the keys", () => {
  const keys = Object.values(KEYS).reduce((n, k) => n + Object.keys(k).length, 0);
  assert.ok(PAGES.size >= PAGE_FLOOR, `${PAGES.size} pages walked, floor ${PAGE_FLOOR}`);
  assert.ok(keys >= KEY_FLOOR, `${keys} keys registered, floor ${KEY_FLOOR}`);
});

test("the probes fire: an unregistered key and an unnamed hand-off are both seen", () => {
  assert.deepEqual(keysRead('const a = sp.x; one("y"); sp["z"]; one(k)'), ["x", "y", "z"]);
  assert.deepEqual(queryHandoffs("rangeFrom(sp, today); leak(sp); f(a, sp)"), ["leak(sp)", "f(a, sp)"]);
});

test("every page is registered, and every registered page exists", () => {
  assert.deepEqual([...PAGES.keys()].sort(), Object.keys(KEYS).sort());
});

for (const [route, src] of PAGES) {
  const name = `/app/[client]${route}`;

  test(`${name}: (a) noindex, (b) login redirect, (c) membership 404`, () => {
    assert.match(src, /robots: \{ index: false, follow: false \}/, "no noindex in the page's own metadata");
    // R164 (1 Oct 2026, danny.md line 173): to the login page carrying next,
    // through loginHref (next-path.ts, its own tests).
    // M1 (6 Oct 2026): the page is built through appPath(), because on
    // app.alwayscited.com it has no /app prefix. The rule is unchanged.
    assert.match(src, /if \(!email\) redirect\(loginHref\(appPath\(`\/\$\{\(await params\)\.client\}/, "no session must redirect to the login page with next");
    assert.match(src, /const clients = await repo\.clientsFor\(email\);/, "the client must come from the session's own clients");
    assert.match(src, /const client = clients\.find\(\(c\) => c\.slug === slug\);\s*if \(!client\) notFound\(\);/, "a slug not among them must 404");
  });

  test(`${name}: (d) every query key is registered with its bound, (e) no unnamed hand-off`, () => {
    const want = KEYS[route] ?? {};
    assert.deepEqual(keysRead(src), Object.keys(want).sort(), "the keys read differ from the keys registered");
    const missing = Object.entries(want)
      .filter(([, needs]) => !src.includes(needs))
      .map(([k, needs]) => `${k}: ${needs}`);
    assert.deepEqual(missing, [], "a registered bound is no longer in the page");
    assert.deepEqual(queryHandoffs(src), [], "the query is handed to a helper not named in READERS");
  });

  test(`${name}: (f) role reads are only the registered ones`, () => {
    const reads = [...src.matchAll(/[^\n]*(?:client\.role\b|writeRole\(client\))[^\n]*/g)]
      .map((m) => m[0])
      .filter((l) => !l.includes("role={client.role}")); // the Sidebar's own badge
    const allowed = ROLE_READS[route] ?? [];
    const stray = reads.filter((l) => !allowed.some((a) => l.includes(a)));
    assert.deepEqual(stray, [], "a role read the census does not know about");
    for (const a of allowed) assert.ok(src.includes(a), `registered role read gone: ${a}`);
  });
}

test("the overview's cluster pick is matched against its own cards", () => {
  // The page passes the raw string; the bound lives in Overview.tsx.
  const overview = readFileSync(join(ROOT, "src", "components", "app", "Overview.tsx"), "utf8");
  assert.ok(overview.includes("cards.find((c) => c.id === selected)"), "Overview no longer matches ?cluster= against its cards");
});
