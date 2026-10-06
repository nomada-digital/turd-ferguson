import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { APP_PREFIX, appHost, appOrigin, appPath, appUrl, internalPath, isAppHost, passesThrough, stripPrefix } from "./app-host.ts";

/**
 * M1 of docs/tracked-dashboard-2026-10-05-app/04-migration-brief.md
 * (Danny, 5 Oct 2026): the dashboard moves to app.alwayscited.com, behind an
 * env var, so the code can ship before the domain exists.
 *
 * The census at the foot is the part that keeps working after today. Every
 * path into the dashboard used to be written out as a literal in 34 files;
 * one left behind is a page that 404s on the new host, and nothing but a
 * sweep finds it.
 */

const OFF = {};
const ON = { APP_HOST: "app.alwayscited.com" };

test("unset is today's behaviour, exactly", () => {
  assert.equal(appHost(OFF), null);
  assert.equal(appPath("/login", false), "/app/login");
  assert.equal(appPath("", false), APP_PREFIX);
  assert.equal(appPath("/tallyroo/clusters", false), "/app/tallyroo/clusters");
  assert.equal(isAppHost("alwayscited.com", OFF), false);
  // With no host configured nothing is the app host, not even a blank one.
  assert.equal(isAppHost(null, OFF), false);
  assert.equal(isAppHost("", OFF), false);
});

test("set, the prefix comes off", () => {
  assert.equal(appHost(ON), "app.alwayscited.com");
  assert.equal(appPath("/login", true), "/login");
  assert.equal(appPath("", true), "/");
  assert.equal(appPath("/", true), "/");
  assert.equal(appPath("/tallyroo/clusters", true), "/tallyroo/clusters");
});

test("the host comparison is whole, lower-cased, and keeps the port", () => {
  assert.equal(isAppHost("app.alwayscited.com", ON), true);
  assert.equal(isAppHost("APP.ALWAYSCITED.COM", ON), true);
  assert.equal(isAppHost("  app.alwayscited.com ", ON), true);
  assert.equal(isAppHost("alwayscited.com", ON), false);
  // Not a suffix match: a host that merely ends with the configured one is a
  // different host, and treating it as the dashboard would hand it the cookie.
  assert.equal(isAppHost("evil-app.alwayscited.com", ON), false);
  assert.equal(isAppHost("app.alwayscited.com.example.net", ON), false);
  // Development uses a port, which is part of the header and part of the value.
  assert.equal(isAppHost("app.localhost:3100", { APP_HOST: "app.localhost:3100" }), true);
  assert.equal(isAppHost("app.localhost", { APP_HOST: "app.localhost:3100" }), false);
});

test("a path arriving on the app host renders the route it always did", () => {
  assert.equal(internalPath("/tallyroo"), "/app/tallyroo");
  assert.equal(internalPath("/tallyroo/clusters"), "/app/tallyroo/clusters");
  assert.equal(internalPath("/"), "/app");
  assert.equal(internalPath("/login"), "/app/login");
});

test("assets, the API and the crawl files are never rewritten", () => {
  for (const p of ["/_next/static/chunk.js", "/api/app/login", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/icon.png"]) {
    assert.equal(passesThrough(p), true, p);
    assert.equal(internalPath(p), p, p);
  }
  for (const p of ["/tallyroo", "/login", "/"]) assert.equal(passesThrough(p), false, p);
});

test("an address carrying the old prefix is recognised, so it can be sent on", () => {
  assert.equal(stripPrefix("/app"), "/");
  assert.equal(stripPrefix("/app/tallyroo"), "/tallyroo");
  assert.equal(stripPrefix("/app/tallyroo/clusters"), "/tallyroo/clusters");
  assert.equal(stripPrefix("/tallyroo"), null);
  // Not a prefix match on the string: /application is not the dashboard.
  assert.equal(stripPrefix("/application"), null);
});

test("an emailed link points at whichever host the dashboard is on", () => {
  assert.equal(appUrl("/auth", "https://alwayscited.com", OFF), "https://alwayscited.com/app/auth");
  assert.equal(appUrl("/auth", "https://alwayscited.com", ON), "https://app.alwayscited.com/auth");
  assert.equal(appUrl("", "https://alwayscited.com/", ON), "https://app.alwayscited.com/");
  assert.equal(appOrigin("https://alwayscited.com", OFF), "https://alwayscited.com");
  assert.equal(appOrigin("https://alwayscited.com", ON), "https://app.alwayscited.com");
  // A development host is http, or the link cannot be opened at all.
  assert.equal(appUrl("/auth", "http://localhost:3100", { APP_HOST: "app.localhost:3100" }), "http://app.localhost:3100/auth");
});

/* ------------------------------------------------------------------ */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.mts")) out.push(full);
  }
  return out;
}

/**
 * Where a literal dashboard path may still be written.
 *
 * Each of these is a reason, not an exemption to be grown. app-host.ts owns
 * the prefix; SiteChrome asks whether a path on the marketing host is the
 * dashboard, which is the one place the literal is the question; next-path
 * accepts both spellings on purpose, because a `next` value may have been
 * minted under either.
 */
const MAY_WRITE_THE_PREFIX = new Set([
  "src/lib/app-host.ts",
  "src/components/SiteChrome.tsx",
  "src/lib/tracking/next-path.ts",
  // robots.ts closes `/app` on the marketing host, which is a crawl rule about
  // that host's own paths and stays true whether or not the dashboard has moved.
  "src/app/robots.ts",
]);

/** A line of code, not a sentence about one: comments and doc blocks are not paths. */
function codeLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    });
}

test("no file writes a dashboard path by hand", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(process.cwd().length + 1);
    if (MAY_WRITE_THE_PREFIX.has(rel)) continue;
    for (const line of codeLines(readFileSync(file, "utf8"))) {
      if (/["'`]\/app(\/|["'`])/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], `use appPath() from src/lib/app-host.ts:\n${offenders.join("\n")}`);
});

/**
 * The floor, so that a sweep which stops matching cannot report a clean tree.
 * 26 files were converted off their literals on 6 Oct 2026; the number only
 * goes up as pages are added, and down only when one is deleted on purpose.
 */
test("the dashboard's paths go through the helper, and there are plenty of them", () => {
  let callers = 0;
  for (const file of walk(SRC)) {
    const rel = file.slice(process.cwd().length + 1);
    if (rel === "src/lib/app-host.ts") continue;
    if (/\bappPath\s*\(/.test(readFileSync(file, "utf8"))) callers += 1;
  }
  assert.ok(callers >= 24, `only ${callers} files call appPath(); 24 is the recorded floor`);
});
