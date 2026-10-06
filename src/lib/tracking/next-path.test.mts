import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NEXT_MAX, loginHref, safeNext } from "./next-path.ts";

/** R164 (1 Oct 2026, danny.md line 173): logged-out bookmarks return to the page, and nowhere else. */

test("a path inside the dashboard is kept", () => {
  for (const ok of ["/app/tallyroo", "/app/tallyroo/clusters", "/app/tallyroo/clusters/c1?range=90d", "/app/x/settings?tab=team"]) {
    assert.equal(safeNext(ok), ok);
  }
});

test("hostile next values are ignored", () => {
  for (const bad of [
    "//example.com",
    "//example.com/app/",
    "/app//example.com",
    "/\\example.com",
    "/app/\\example.com",
    "\\\\example.com",
    "https://example.com/app/x",
    "/app/x?u=https://example.com",
    "javascript:alert(1)",
    "/app",
    "/apple",
    "/admin/tracking",
    "app/x",
    "/app/x\nLocation: //example.com",
    "/app/login",
    "/app/login?next=/app/x",
    "/app/auth?token=x",
    "/app/" + "a".repeat(NEXT_MAX),
    "",
    null,
    undefined,
    ["/app/x"],
  ]) {
    assert.equal(safeNext(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("loginHref carries the page and its query, encoded, and drops an unsafe one", () => {
  assert.equal(loginHref("/app/tallyroo/clusters"), "/app/login?next=%2Fapp%2Ftallyroo%2Fclusters");
  assert.equal(loginHref("/app/t/named", { range: "90d", e: ["a", "b"] }), `/app/login?next=${encodeURIComponent("/app/t/named?range=90d&e=a&e=b")}`);
  assert.equal(loginHref("//example.com"), "/app/login");
});

/** Census: every /app page that refuses a signed-out visitor sends them to the login page with next. */
test("every /app/[client] page redirects signed-out visitors through loginHref", () => {
  const root = join(import.meta.dirname, "../../app/app/[client]");
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === "page.tsx") pages.push(p);
    }
  };
  walk(root);
  assert.ok(pages.length >= 8, `found ${pages.length} pages, floor 8`);
  for (const p of pages) {
    const s = readFileSync(p, "utf8");
    assert.ok(!s.includes('redirect(appPath("/login"))'), `${p} drops the page it was asked for`);
    // M1 (6 Oct 2026): the page the visitor was on is now built through
    // appPath(), because on app.alwayscited.com it is `/tallyroo/named` and
    // on the marketing host `/app/tallyroo/named`. The rule is unchanged -
    // every page that refuses a signed-out visitor carries where they were.
    assert.match(s, /if \(!email\) redirect\(loginHref\(appPath\(`\/\$\{\(await params\)\.client\}/, `${p} does not carry next`);
  }
});

test("next is re-validated on every hop", () => {
  const read = (p: string) => readFileSync(join(import.meta.dirname, "../../app", p), "utf8");
  assert.match(read("app/login/page.tsx"), /next=\{safeNext\(q\.next\)/);
  assert.match(read("api/app/login/route.ts"), /const next = safeNext\(body\.next\)/);
  assert.match(read("app/auth/page.tsx"), /const next = safeNext\(rawNext\)/);
  assert.match(read("api/app/auth/route.ts"), /const next = safeNext\(form\?\.get\("next"\)\)/);
});
