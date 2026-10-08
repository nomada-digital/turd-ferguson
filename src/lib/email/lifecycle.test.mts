import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { trialCharge, trialMoment } from "../../config/trial.ts";
import { TIER_PLAIN } from "../tier-text.ts";
import { flagFor, flagOn, LIFECYCLE_EMAILS, planEnded, previews, previewSets, setupReminder, welcome } from "./lifecycle.ts";

/** R159 (1 Oct 2026): the lifecycle templates' shared rules, on the preview fixtures. Nothing is sent. */

/**
 * A made-up price, so these tests check that the charge is worded by
 * trialCharge and never hold a second copy of TRACKED_PRICE (pricing.ts is
 * not loadable here; the preview page passes the real one).
 */
const PRICE = { us: 101, uk: 77 };
const all = previews(PRICE);
const sets = previewSets(PRICE);
/** Every case of every email, as the preview page draws them. */
const every = Object.entries(sets).flatMap(([name, list]) => list.map((p) => [`${name} (${p.label})`, p.mail] as const));

/**
 * Six until 8 Oct 2026, when the trial's three joined (audit activation-1,
 * copy-4): trial_started (the welcome for a trial order), trial_midpoint and
 * trial_ending, each behind its own flag.
 */
test("every lifecycle email has a template and a preview, and its flag is email_<name>_enabled", () => {
  assert.deepEqual(Object.keys(all).sort(), [...LIFECYCLE_EMAILS].sort());
  assert.deepEqual(Object.keys(sets).sort(), [...LIFECYCLE_EMAILS].sort());
  assert.equal(LIFECYCLE_EMAILS.length, 9);
  for (const n of LIFECYCLE_EMAILS) {
    assert.match(flagFor(n), /^email_[a-z_]+_enabled$/);
    assert.ok(sets[n].length >= 1, `${n} has no preview`);
    assert.equal(new Set(sets[n].map((p) => p.label)).size, sets[n].length, `${n}: two previews share a label`);
  }
  assert.ok(every.length >= 15, `only ${every.length} preview cases: the sweep below is reading too few`);
});

test("each has one button, the help block and the footer company line, in HTML and plain text", () => {
  for (const [name, m] of every) {
    assert.equal(m.html.match(/<td bgcolor=/g)?.length, 1, `${name}: one button`);
    for (const part of [m.html, m.text]) {
      assert.ok(part.includes(COMPANY_LINE), `${name}: company line`);
      assert.ok(part.includes(CONTACT_EMAIL), `${name}: email us`);
      assert.match(part, /Book a call/, `${name}: book a call`);
      assert.match(part, /\/contact\?tier=always/, `${name}: the call is prefilled with the tier`);
    }
    assert.ok(m.subject.length > 0 && m.subject.length < 90, `${name}: subject`);
  }
});

test("the brand is lowercase and tiers are TIER_PLAIN, never a capitalised form", () => {
  for (const [name, m] of every) {
    for (const part of [m.subject, m.html, m.text]) {
      assert.doesNotMatch(part, /AlwaysCited|Alwayscited|always cited|Always(tracked|mentioned|everywhere)/, name);
      assert.doesNotMatch(part, /tier-name__accent|--brand-purple/, `${name}: no tier colouring in mail`);
    }
  }
  assert.ok(all.welcome.text.includes(TIER_PLAIN.mentioned));
  assert.ok(all.plan_ended.subject.includes(TIER_PLAIN.cited));
});

// "with 1 cluster" was asserted here for tracked until 8 Oct 2026 - the defect
// audit activation-16 names: the alwaystracked plan is 10 clusters, and 1 is
// only what signup makes. A placements order still states what it bought.
test("what the buyer typed is escaped in the HTML", () => {
  const m = welcome({ tier: "mentioned", clusters: 1, clusterLimit: 10, domain: `a<b>&"c.com`, link: "https://alwayscited.com/app/auth?token=x&y=1" });
  assert.ok(!m.html.includes("a<b>"), "domain escaped");
  assert.ok(m.html.includes("a&lt;b&gt;&amp;&quot;c.com"));
  assert.ok(m.html.includes('href="https://alwayscited.com/app/auth?token=x&amp;y=1"'));
  assert.ok(m.text.includes(`a<b>&"c.com`), "plain text is as typed");
  assert.match(m.text, /with 1 cluster\./);
});

test("activation-16: the alwaystracked welcome states the plan's 10 clusters, and on the trial never says bought", () => {
  const base = { tier: "tracked" as const, clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x" };
  const paid = welcome(base);
  assert.match(paid.text, /tracks up to 10 clusters/);
  assert.doesNotMatch(paid.text, /with 1 cluster/);
  const trial = welcome({ ...base, trial: { ends: "22 Oct 2026, 3:30pm ET", charge: "$101 a month", billing: "https://example.com/b#set-billing" } });
  assert.match(trial.text, /10 clusters/);
  assert.match(trial.subject, /free trial/);
  assert.match(trial.text, /free trial/);
  assert.doesNotMatch(trial.text, /\bbought\b/i);
  assert.doesNotMatch(trial.text, /with 1 cluster/);
});

test("activation-16: the setup reminder says what the runner does - prompts are read whether or not setup is confirmed", () => {
  const some = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 1, clusterLimit: 10 });
  assert.match(some.text, /are being checked, but 9 of your 10 clusters are still empty/);
  assert.doesNotMatch(some.text + some.html, /Nothing is checked/);
  const none = setupReminder({ tier: "tracked", domain: "example.com", link: "https://example.com/s", withPrompts: 0, clusterLimit: 10 });
  assert.match(none.text, /Nothing is checked until your first cluster has prompts/);
  assert.equal(sets.setup_reminder.length, 2, "both cases are drawn for approval");
});

/**
 * activation-1 and copy-4 (8 Oct 2026): the trial's emails, on a tracked-tier
 * trial in both zones. Each running-trial email names the end moment as
 * trialMoment words it for the market, the charge as trialCharge words it,
 * and the cancel route, linked to the client's Billing. None says bought or
 * receipt. The ended trial says it was not charged and that there is no second trial.
 */
const US_END = trialMoment("2026-10-22T19:30:00Z", "US");
const UK_END = trialMoment("2026-10-22T13:30:00Z", "UK");

test("activation-1, copy-4: trial_started, trial_midpoint and trial_ending name the end in the market's zone, the charge and the cancel route", () => {
  assert.equal(US_END, "22 Oct 2026, 3:30pm ET");
  assert.equal(UK_END, "22 Oct 2026, 14:30 UK time");
  for (const name of ["trial_started", "trial_midpoint", "trial_ending"] as const) {
    const cases = sets[name];
    assert.equal(cases.length, 2, `${name}: a US and a UK case`);
    for (const [i, { label, mail }] of cases.entries()) {
      const [end, charge] = i === 0 ? [US_END, trialCharge("US", PRICE)] : [UK_END, trialCharge("UK", PRICE)];
      const where = `${name} (${label})`;
      assert.ok(mail.text.includes(end), `${where}: names ${end}`);
      assert.ok(mail.text.includes(charge), `${where}: names ${charge}`);
      assert.match(mail.text, /cancel[^\n]*Settings > Billing \(https:\/\/alwayscited\.com\/app\/tallyroo-com\/settings#set-billing\)/i, `${where}: the cancel route, linked`);
      assert.match(mail.html, /<a href="https:\/\/alwayscited\.com\/app\/tallyroo-com\/settings#set-billing"[^>]*>Settings &gt; Billing<\/a>/, `${where}: the link in the HTML`);
      assert.doesNotMatch(mail.subject + mail.text, /You bought|\bbought\b|receipt/i, where);
    }
  }
  assert.match(sets.trial_started[0]!.mail.subject, /^Your 14-day free trial of alwaystracked has started$/);
  assert.match(sets.trial_ending[0]!.mail.text, /To keep tracking, there is nothing to do\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /named in 7 of 60 AI answers\. The other brand named most often: Xero, in 31 answers\./);
  assert.match(sets.trial_midpoint[0]!.mail.text, /You are using 2 of your 10 clusters\./);
  assert.match(sets.trial_midpoint[1]!.mail.text, /Nothing has been checked yet: no cluster has prompts\./);
});

test("copy-4: plan_ended for a trial that ended uncharged - no receipt, not charged, no second trial; the paid one sends the owner to ask us", () => {
  const trial = planEnded({ tier: "tracked", domain: "example.com", billing: "https://example.com/b", trial: true });
  assert.match(trial.text, /You were not charged/);
  assert.match(trial.text, /no second free trial/);
  assert.doesNotMatch(trial.subject + trial.text, /receipt|pick the plan again|You bought/i);
  const paid = planEnded({ tier: "cited", domain: "example.com", billing: "https://example.com/b" });
  // "To restart, pick the plan again; the dashboard picks up where it stopped" until 8 Oct 2026:
  // a new order cannot bring an ended client back (cbdffad), so it asks us, as the ended banner does.
  assert.doesNotMatch(paid.text, /pick the plan again|picks up where it stopped/);
  for (const m of [trial, paid]) assert.match(m.html, />Ask us to restart it<\/a>/);
  assert.ok(sets.plan_ended.some((p) => /trial/.test(p.label)), "the trial case is drawn for approval");
});

test("the welcome carries the sign-in link on its one button and the 3-step strip", () => {
  const m = all.welcome;
  assert.equal(m.subject, "You're in - set up your clusters");
  assert.match(m.html, />Set up your clusters<\/a>/);
  assert.match(m.html, /app\/auth\?token=preview-only/);
  assert.equal(m.html.match(/<li /g)?.length, 3);
  assert.match(m.text, /\n1\. .*\n2\. .*\n3\. /);
});

test("the templates do not send: no mail client, network or flag write in the module", async () => {
  // lifecycle-schedule.ts joined 8 Oct 2026: it decides when, and must not send either.
  for (const file of ["./lifecycle.ts", "./lifecycle-schedule.ts"]) {
    const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /resend|fetch\(|\.from\(|process\.env/i, file);
  }
});

test("a flag is on only for jsonb true; a missing row or any other value is off", () => {
  assert.equal(flagOn(true), true);
  for (const v of [undefined, null, false, "true", 1, {}, []]) assert.equal(flagOn(v), false, JSON.stringify(v));
});

/** Part 3 (1 Oct 2026): the flags ship off, and each send site asks its own flag first. */
test("every flag ships off, and each send site asks its flag before sending", async () => {
  const fs = await import("node:fs");
  const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const sql = fs.readdirSync(dir).map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
  for (const n of LIFECYCLE_EMAILS) {
    assert.match(sql, new RegExp(`\\('${flagFor(n)}', 'false'::jsonb\\)`), `${flagFor(n)} not inserted as false`);
    assert.doesNotMatch(sql, new RegExp(`'${flagFor(n)}', 'true'`), `${flagFor(n)} switched on in a migration`);
  }
  const signup = read("../checkout/signup.ts");
  assert.equal(signup.match(/sendLifecycle\(/g)?.length, 2, "welcome and plan_ended are the two send sites");
  // 8 Oct 2026 (audit activation-1): a trial order's welcome asks trial_started's flag, never welcome's.
  assert.match(signup, /lifecycleOn\(db, trial \? "trial_started" : "welcome"\)[\s\S]{0,300}sendLifecycle\(\{ memberEmail: o\.email, mail: welcome\(/);
  assert.match(signup, /lifecycleOn\(db, "plan_ended"\)[\s\S]{0,800}sendLifecycle\(\{ memberEmail: m\.email as string, mail \}\)/);
  assert.match(signup, /: await sendLoginLink\(\{ memberEmail: o\.email, link \}\)/, "the login link stays the default while welcome is off");
  // The invite: branded only outside agency mode and with its flag on, else the plain inviteMail as before.
  const member = read("../../app/api/app/[client]/member/route.ts");
  assert.match(member, /!agency && \(await lifecycleOn\(db, "invite"\)\)\s*\? inviteEmail\([\s\S]{0,300}: inviteMail\(\{ inviter: email, domain: client\.domain, role: f\.role!, agency \}\)/);
});

test("first_reading: flag first, the client's only finished run, no agency, the Overview's own figures", () => {
  const runner = fs.readFileSync(new URL("../tracking/runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("async function mailFirstReading"));
  assert.ok(body.length > 200, "mailFirstReading is gone from runner.ts");
  const at = (s: string) => body.indexOf(s);
  assert.ok(at('lifecycleOn(db, "first_reading")') >= 0 && at('lifecycleOn(db, "first_reading")') < at("sendLifecycle("), "the flag is asked before the send");
  assert.ok(at("if (count !== 1) return;") >= 0 && at("if (count !== 1) return;") < at("sendLifecycle("), "only on the client's first finished run");
  assert.ok(at('=== "agency") return;') >= 0 && at('=== "agency") return;') < at("sendLifecycle("), "never in agency mode");
  assert.match(runner, /named: namedRate\(answerRows, range\),\s*page1: keywordsOnPage1\(serpRows, range, keywords\.length\)/);
});

test("the invite names who added you and the role", () => {
  const t = all.invite.text;
  assert.match(t, /sam@tallyroo\.com added you to the tallyroo\.com dashboard as a viewer/);
});
