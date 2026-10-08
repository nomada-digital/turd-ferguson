import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { BUILD_DIR, PRERENDER_DIR as PRERENDER, sweptPages } from "./dynamic-render.mts";
import { APP, disallowedPaths, noindexHeaderRules, privateRoutes, probePath } from "./route-probes.mts";

/**
 * The response headers, and the three mechanisms that close a route.
 *
 * `next.config.ts` and `src/proxy.ts` were the last two things here served to
 * somebody that nothing read. Every sweep in this tree asks questions about
 * markup; a header is not markup, and `proxy.ts` produces no page at all, so
 * both walked past all of it.
 *
 * And the gap was not academic. A private route is closed three ways on this
 * site, each addressed to a different reader:
 *
 *   a `robots: { index: false }` meta tag   what a crawler reads once it has
 *                                           already fetched the page
 *   an `x-robots-tag` response header       the same directive for a reader
 *                                           that never parses the HTML
 *   a `Disallow` in robots.txt              what stops the fetch happening
 *
 * `robots.ts` spells out why the meta tag alone is not enough: it "is a
 * directive about indexing, addressed to search engines", and a token link that
 * reaches anywhere public - an unfurl, a forwarded mail in an archived list -
 * was fetchable by every agent that file names. `/scan/[token]` carries all
 * three for exactly that reason.
 *
 * `/coverage-check/[token]` carried one. Its own source says "Every one of
 * these is somebody's own campaign, with a client brand and an uploaded
 * coverage list on it" - the same sentence, the same exposure - and it reached
 * production with the meta tag only, because the campaign benchmark was built
 * after the two files that would have closed it and neither file can see a
 * route appear.
 *
 * **Nothing here could have caught it, and that is the point.** The three
 * routes that most need this check - both `[token]` pages and `/admin/scans` -
 * are precisely the three `dynamic-render.mts` records as unrenderable, so a
 * sweep over rendered pages reads none of them. The denominator again. So the
 * private set below is derived from **source**, which is the only place all
 * three are visible, and checked against the **build manifest**, which is what
 * actually ships.
 */

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

// ------------------------------------------------------------- the probes

/*
 * privateRoutes, probePath, noindexHeaderRules and disallowedPaths moved to
 * route-probes.mts on 20 Sep 2026. Three suites need them, and importing a
 * test module registers its tests - so they were being re-stated per file,
 * identically, with nothing reconciling the copies. The note that used to sit
 * on disallowedPaths explaining the re-statement is now the header of that
 * module, explaining why it is not a test.
 */

/**
 * Off-origin URLs in the code that ships to the browser.
 *
 * Keyed on `"use client"` rather than on the shape of the call, which is the
 * correction that matters here. The first cut of this probe looked for
 * `src = "https://..."` and read **zero** origins on a site that loads one:
 * `Turnstile.tsx` holds its URL in a named constant and assigns it later, so
 * a literal-assignment probe walks past the only third-party subresource on
 * the site. That is this repo's "a tripwire can pass because it is blind",
 * caught here by the counter-guard rather than by a later run.
 *
 * A `"use client"` file's off-origin URL is fetched by the browser whichever
 * form it takes - script, iframe or fetch - and all three are CSP-governed.
 * A server module's is not: `lib/scan/turnstile.ts` calls the same host from
 * the server, where no CSP applies, and is correctly not counted.
 */
export function clientOrigins(dir: string): { origin: string; where: string }[] {
  const out: { origin: string; where: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const src = readFileSync(full, "utf8");
        if (!/^\s*["']use client["']/m.test(src)) continue;
        for (const m of src.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
          try {
            out.push({ origin: new URL(m[1]!).origin, where: relative(ROOT, full).split(sep).join("/") });
          } catch {
            /* not a URL we can classify */
          }
        }
      }
    }
  };
  walk(dir);
  return out;
}

// -------------------------------------------------------------- the guards

test("the closure probes fire on the shapes that are wrong", () => {
  assert.equal(probePath("/coverage-check/[token]"), "/coverage-check/probe");
  assert.equal(probePath("/admin/scans"), "/admin/scans");

  const manifest = JSON.stringify({
    headers: [
      { source: "/:path*", regex: "^/.*$", headers: [{ key: "x-frame-options", value: "SAMEORIGIN" }] },
      { source: "/scan/:path+", regex: "^/scan(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))(?:/)?$", headers: [{ key: "x-robots-tag", value: "noindex, nofollow" }] },
    ],
  });

  const rules = noindexHeaderRules(manifest);
  assert.equal(rules.length, 1, "only the x-robots-tag rule is a closure rule");

  // The `:path+` lesson, re-proved against Next's own compiled regex rather
  // than asserted in prose: the rule must cover a token and must NOT cover the
  // bare entry page, which has to stay crawlable.
  assert.ok(rules[0]!.regex.test("/scan/abc123"), ":path+ must match a token");
  assert.ok(!rules[0]!.regex.test("/scan"), ":path+ must not match the bare page");

  assert.deepEqual(disallowedPaths("User-Agent: *\nDisallow: /scan/\nDisallow: /api/\n"), ["/scan/", "/api/"]);
});

test("the client-origin probe reads a constant and ignores a server module", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "csp-probe-"));

  // The indirection the first cut of this probe was blind to: the URL is a
  // named constant, assigned to `.src` somewhere else entirely.
  writeFileSync(
    join(dir, "Widget.tsx"),
    '"use client";\n' +
      'const SCRIPT_SRC = "https://cdn.example.net/widget.js";\n' +
      "useEffect(() => { const s = document.createElement('script'); s.src = SCRIPT_SRC; }, []);\n",
    "utf8",
  );
  // Same host, server side, no CSP in play.
  writeFileSync(join(dir, "verify.ts"), 'const VERIFY = "https://api.example.com/siteverify";\n', "utf8");

  const found = clientOrigins(dir);
  t.diagnostic(`probe read ${found.length} client origin(s) from injected files`);

  assert.deepEqual(
    found.map((f) => f.origin),
    ["https://cdn.example.net"],
    "a URL in a client component counts however it is assigned; a server module's does not count at all",
  );
});

// --------------------------------------------------------- the real files

test("every noindex route is closed by a header and by robots.txt", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const routes = privateRoutes();
  const rules = noindexHeaderRules(readFileSync(join(BUILD_DIR, "routes-manifest.json"), "utf8"));
  const closed = [...new Set(disallowedPaths(readFileSync(join(BUILD_DIR, "server", "app", "robots.txt.body"), "utf8")))];

  // Counter-guards. An empty finding and a probe that has stopped matching
  // look identical, which is the `75ff8d6` lesson.
  assert.ok(routes.length >= 4, `only ${routes.length} noindex routes found - the source probe has drifted`);
  assert.ok(rules.length >= 2, `only ${rules.length} x-robots-tag rules - the manifest probe has drifted`);
  assert.ok(closed.length >= 3, `only ${closed.length} Disallow rules - the robots parser has drifted`);

  /**
   * The one earned exemption: bare `/scan`.
   *
   * It is noindex and must stay both fetchable and headerless, because it is
   * the action of the no-JS GET forms across the site and "a disallowed URL
   * that is linked from the site gets listed as a bare address, which is worse
   * than the noindex it already carries" - `robots.ts`, in its own words.
   *
   * Proved rather than assumed: if nothing renders a form at `/scan` any more,
   * the reason has evaporated and the exemption fails with it.
   */
  const EXEMPT = "/scan";
  const formTargets = sweptPages().filter((p) => /action="\/scan"/.test(p.html));
  assert.ok(
    formTargets.length > 0,
    `${EXEMPT} is exempt from closure because it is a GET form target, and no swept page posts a form ` +
      `at it any more. Either restore the form or close the route like every other noindex page.`,
  );

  const gaps: string[] = [];
  for (const route of routes) {
    if (route === EXEMPT) continue;
    const path = probePath(route);
    const headed = rules.filter((r) => r.regex.test(path)).map((r) => r.source);
    const blocked = closed.filter((c) => path.startsWith(c));

    if (!headed.length) gaps.push(`  ${route}  (${path})  no x-robots-tag rule matches it`);
    if (!blocked.length) gaps.push(`  ${route}  (${path})  no robots.txt Disallow covers it`);
  }

  t.diagnostic(
    `${routes.length} noindex routes, ${rules.length} header rules, ${closed.length} Disallow rules; ` +
      `${formTargets.length} pages post a form at ${EXEMPT}`,
  );

  assert.deepEqual(
    gaps,
    [],
    "These routes declare themselves noindex and are not closed to a reader that never parses the " +
      "HTML. Add the header rule to `headers()` in next.config.ts and the path to CLOSED in " +
      "src/app/robots.ts, both the way /scan/ does it:\n" + gaps.join("\n"),
  );
});

test("the shipped CSP permits every subresource the site loads", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const manifest = JSON.parse(readFileSync(join(BUILD_DIR, "routes-manifest.json"), "utf8")) as {
    headers: { headers: { key: string; value: string }[] }[];
  };
  const csp = manifest.headers
    .flatMap((r) => r.headers)
    .find((h) => h.key.toLowerCase() === "content-security-policy")?.value;

  assert.ok(csp, "no content-security-policy in the build manifest");
  assert.ok(/default-src 'self'/.test(csp!), "the CSP probe has drifted - no default-src in what it read");

  const loaded = clientOrigins(join(ROOT, "src"));
  const missing = loaded.filter(({ origin }) => !csp!.includes(origin));

  // The probe reading nothing is the failure mode that looks like a pass.
  assert.ok(
    loaded.length > 0,
    "the client-origin probe found no off-origin URL in any client component - it has gone blind, " +
      "which is how this check would silently stop guarding anything",
  );

  t.diagnostic(`${loaded.length} off-origin URL(s) in client code: ${[...new Set(loaded.map((l) => l.origin))].join(" ")}`);

  assert.deepEqual(
    missing.map((m) => `  ${m.origin}  loaded by ${m.where}`),
    [],
    "The browser is told to load these and the Content-Security-Policy does not permit them, so " +
      "production drops them silently while every local check passes. Add each origin to the right " +
      "directive in CSP in next.config.ts:\n" + missing.map((m) => `  ${m.origin}  (${m.where})`).join("\n"),
  );

  // The other direction: a third-party origin allowed long after the thing
  // that needed it went. An allowance nobody uses is a hole nobody is watching.
  // form-action is left out: its origins are where a form's redirect may land
  // (Stripe's hosted checkout, R155, 1 Oct 2026), not anything client code
  // loads, and privacy-claims pins them as FORM_TARGETS.
  const subresources = csp!.split(";").filter((d) => !/^\s*form-action\b/.test(d)).join(";");
  assert.ok(subresources.length < csp!.length, "the CSP no longer has a form-action directive, so the line above excludes nothing");
  const allowed = [...new Set([...subresources.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]))];
  const stale = allowed.filter((origin) => !loaded.some((l) => origin.startsWith(l.origin)));
  assert.deepEqual(
    stale,
    [],
    "The CSP allows these origins and nothing in src/ loads them. Remove each from CSP in " +
      "next.config.ts:\n" + stale.map((s) => `  ${s}`).join("\n"),
  );
});

test("the admin proxy matches every route that must stay shut", (t) => {
  const proxy = readFileSync(join(ROOT, "src", "proxy.ts"), "utf8");
  // The rule: every route that must stay shut is matched by the proxy, so
  // Basic auth runs before it renders.
  /**
   * 8 Oct 2026 (M1 host routing, shipped): no matcher at all. A config export
   * is gone, so this version registers the proxy with `/:path*` - `^.*$` in
   * the built functions-config-manifest.json, the matcher Next actually runs.
   * The rule is unchanged; what moved is where the matcher is read: off the
   * build when there is one, and on an unbuilt tree from the rule that no
   * config export means every path. A config export coming back is read the
   * old way.
   */
  const adminRoutes = privateRoutes().filter((r) => r.startsWith("/admin"));
  assert.ok(adminRoutes.length > 0, "no /admin route found - the source probe has drifted");

  let matchers: RegExp[];
  let matcher: string;
  const manifest = join(ROOT, ".next", "server", "functions-config-manifest.json");
  if (/export const config\b/.test(proxy)) {
    // The patterns themselves contain brackets, so the block is taken from
    // `matcher:` to the end of the config object rather than to the first `]`.
    const block = proxy.slice(proxy.indexOf("matcher:"));
    const entries = [...block.slice(0, block.indexOf("};")).matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!);
    assert.ok(entries.length > 0, "no matcher in src/proxy.ts - the proxy probe has drifted");
    matchers = entries.map((src) => new RegExp(`^${src.replace(/\/:path\*$/, "(?:/.*)?")}$`));
    matcher = entries.join(" , ");
  } else if (existsSync(manifest)) {
    const fn = (JSON.parse(readFileSync(manifest, "utf8")) as { functions: Record<string, { matchers?: { regexp: string }[] }> }).functions["/_middleware"];
    assert.ok(fn?.matchers?.length, "the build registered no proxy - /admin's Basic auth is not running");
    matchers = fn.matchers.map((m) => new RegExp(m.regexp));
    matcher = fn.matchers.map((m) => m.regexp).join(" , ");
  } else {
    matchers = [/^.*$/];
    matcher = "/:path* (no config export, unbuilt tree)";
  }
  // Inside the proxy, the early exit hands a path straight back unauthenticated,
  // so it must never cover /admin; and /admin must still reach the auth branch.
  const skipBody = proxy.slice(proxy.indexOf("export function skip"));
  assert.doesNotMatch(skipBody.slice(0, skipBody.indexOf("\n}")), /admin/, "skip() must not hand /admin back before Basic auth");
  assert.match(proxy, /if \(ADMIN\(pathname\)\)\s*\{[\s\S]{0,200}return admin\(request\);/, "the proxy no longer sends /admin to Basic auth");
  const unguarded = adminRoutes.filter((r) => !matchers.some((re) => re.test(r)));

  t.diagnostic(`matcher ${matcher} guards ${adminRoutes.length} admin route(s): ${adminRoutes.join(" ")}`);
  assert.deepEqual(
    unguarded,
    [],
    "These routes are under an admin path the proxy matcher does not cover, so they render to " +
      "anyone:\n" + unguarded.join("\n"),
  );

  // The proxy fails shut. Verified as source rather than behaviour because it
  // runs before rendering and this machine cannot invoke it, but the branch is
  // the difference between an unconfigured deploy serving 503 and serving the
  // ops page to the public.
  assert.match(
    proxy,
    /if\s*\(!user\s*\|\|\s*!password\)\s*\{[\s\S]{0,200}status:\s*503/,
    "proxy.ts must refuse when no credentials are configured, not fall through",
  );
});
