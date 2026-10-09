import assert from "node:assert/strict";
import { test } from "node:test";

import { INVITES_PER_OWNER_PER_DAY, MEMBERS_PER_CLIENT, TEAM_WHY, type TeamRow, inviteMail, inviteRefusal, inviteScope, onClient, readEmail, readTeamForm, refuseActor, refuseChange, refuseInvite, removeKind, removeLine, scopeLine, teamReturn, teamToast, teamWhy } from "./team.ts";

/** R142 part 2 (1 Oct 2026; BRIEF-4 P2 Team): the rules the member route runs before any write. */

const row = (email: string, role: string, removed = false): TeamRow => ({ email, role, removed_at: removed ? "2026-09-30T10:00:00Z" : null });
const team = [row("owner@tallyroo.com", "owner"), row("ed@tallyroo.com", "editor"), row("vi@tallyroo.com", "viewer"), row("gone@tallyroo.com", "editor", true)];

test("an email is trimmed, lowercased, format-checked and at most 254 characters", () => {
  assert.equal(readEmail("  New@Tallyroo.COM "), "new@tallyroo.com");
  assert.equal(readEmail("not-an-email"), null);
  assert.equal(readEmail("a@b"), null);
  assert.equal(readEmail(`${"a".repeat(250)}@example.com`), null);
  assert.equal(readEmail(42), null);
});

test("the form: invite and role need Editor or Viewer, never owner; remove needs none", () => {
  const f = (o: Record<string, string>) => readTeamForm((k) => o[k] ?? null);
  // AG-1 (9 Oct 2026): the form carries the invite's scope word, null when it sent none it knows.
  assert.deepEqual(f({ op: "invite", email: "x@tallyroo.com", role: "viewer" }), { op: "invite", email: "x@tallyroo.com", role: "viewer", scope: null });
  assert.deepEqual(f({ op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "account" }), { op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "account" });
  assert.equal(f({ op: "invite", email: "x@tallyroo.com", role: "viewer", scope: "everyone" })!.scope, null);
  assert.equal(f({ op: "invite", email: "x@tallyroo.com", role: "owner" }), null);
  assert.equal(f({ op: "role", email: "x@tallyroo.com" }), null);
  assert.deepEqual(f({ op: "remove", email: "x@tallyroo.com", role: "owner", scope: "account" }), { op: "remove", email: "x@tallyroo.com", role: null, scope: null });
  assert.equal(f({ op: "delete", email: "x@tallyroo.com" }), null);
});

test("owner only", () => {
  assert.equal(refuseActor("owner"), null);
  assert.ok(refuseActor("editor"));
  assert.ok(refuseActor("viewer"));
});

test("invite refuses a live member and lets a removed one back on the same row", () => {
  assert.ok(refuseInvite({ rows: team, email: "ed@tallyroo.com", invitesToday: 0 }));
  assert.equal(refuseInvite({ rows: team, email: "gone@tallyroo.com", invitesToday: 0 }), null);
  assert.equal(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: 0 }), null);
});

// 10 live members an account until 9 Oct 2026 (AG-1): 10 who see a client, as onClient narrows the rows the route passes.
test("invite caps: 10 live members a client, 20 invites an owner a day", () => {
  const full = Array.from({ length: MEMBERS_PER_CLIENT }, (_, i) => row(`m${i}@tallyroo.com`, i ? "editor" : "owner"));
  assert.ok(refuseInvite({ rows: full, email: "new@tallyroo.com", invitesToday: 0 }));
  // Removed rows do not count toward the ten.
  assert.equal(refuseInvite({ rows: [...full.slice(1), row("x@tallyroo.com", "editor", true)], email: "new@tallyroo.com", invitesToday: 0 }), null);
  assert.ok(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY }));
  assert.equal(refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY - 1 }), null);
});

test("no one changes or removes themselves, nor the last owner", () => {
  const actor = "owner@tallyroo.com";
  assert.ok(refuseChange({ rows: team, actor, email: actor, op: "remove", role: null }));
  assert.ok(refuseChange({ rows: team, actor: "o2@tallyroo.com", email: actor, op: "remove", role: null }));
  assert.ok(refuseChange({ rows: team, actor: "o2@tallyroo.com", email: actor, op: "role", role: "editor" }));
  const two = [...team, row("o2@tallyroo.com", "owner")];
  assert.equal(refuseChange({ rows: two, actor: "o2@tallyroo.com", email: actor, op: "remove", role: null }), null);
  assert.equal(refuseChange({ rows: team, actor, email: "ed@tallyroo.com", op: "role", role: "viewer" }), null);
  assert.ok(refuseChange({ rows: team, actor, email: "ed@tallyroo.com", op: "role", role: "editor" }), "already an editor");
  assert.ok(refuseChange({ rows: team, actor, email: "gone@tallyroo.com", op: "remove", role: null }), "a removed member is not on the team");
});

test("the return URL and toast carry fixed words and a checked email only", () => {
  assert.equal(teamReturn("tallyroo", "invited", "new@tallyroo.com"), `/app/tallyroo/settings?${new URLSearchParams({ team: "invited", who: "new@tallyroo.com" })}#set-team`);
  assert.equal(teamReturn("tallyroo", "refused", "new@tallyroo.com"), "/app/tallyroo/settings?team=refused#set-team");
  // DS40 (2 Oct 2026): a stated range comes back ahead of the toast; any other kept key does not.
  assert.equal(teamReturn("tallyroo", "refused", null, { from: "2026-09-20", to: "2026-09-26", compare: "none", filter: "named", q: "x" }), "/app/tallyroo/settings?from=2026-09-20&to=2026-09-26&compare=none&team=refused#set-team");
  assert.equal(teamToast("invited", "new@tallyroo.com", "viewer"), "Invited new@tallyroo.com.");
  assert.equal(teamToast("invited", "stranger@tallyroo.com", null), null, "R146: not on the team, so nobody was invited");
  assert.equal(teamToast("removed", "gone@tallyroo.com", null), "Removed gone@tallyroo.com.");
  assert.equal(teamToast("removed", "still@tallyroo.com", "editor"), null, "R146: still on the team, so nobody was removed");
  assert.equal(teamToast("role", "vi@tallyroo.com", "viewer"), "vi@tallyroo.com is now a viewer.");
  assert.equal(teamToast("invited", "<script>@x", null), null);
  assert.equal(teamToast("role", "vi@tallyroo.com", null), null, "not a member any more: no claim about their role");
  assert.equal(teamToast("anything", "vi@tallyroo.com", null), null);
});

test("R151 (3 Oct 2026): a refusal comes back as its code and says its reason, never the address", () => {
  // Every sentence a rule returns has a code, so no rule's refusal falls back to "Reload the page".
  const said = [
    refuseActor("viewer"),
    refuseInvite({ rows: team, email: "ed@tallyroo.com", invitesToday: 0 }),
    refuseInvite({ rows: team, email: "new@tallyroo.com", invitesToday: INVITES_PER_OWNER_PER_DAY }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "o2@tallyroo.com", op: "remove", role: null }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "gone@tallyroo.com", op: "remove", role: null }),
    refuseChange({ rows: team, actor: "o2@tallyroo.com", email: "ed@tallyroo.com", op: "role", role: "editor" }),
  ];
  for (const s of said) assert.ok(s && teamWhy(s), `no code for: ${s}`);
  assert.equal(new Set(Object.values(TEAM_WHY)).size, Object.keys(TEAM_WHY).length, "each code says a different sentence");
  // The URL carries the code, not the email; an invite refusal opens the invite form, whose field autofocuses.
  assert.equal(teamReturn("tallyroo", "refused", "ed@tallyroo.com", {}, "already"), "/app/tallyroo/settings?team=refused&why=already", "no fragment: a target stops autofocus");
  assert.equal(teamReturn("tallyroo", "refused", "o2@tallyroo.com", {}, "self"), "/app/tallyroo/settings?team=refused&why=self#set-team");
  assert.equal(teamReturn("tallyroo", "invited", "new@tallyroo.com", {}, "already"), `/app/tallyroo/settings?${new URLSearchParams({ team: "invited", who: "new@tallyroo.com" })}#set-team`);
  // The invite form draws its own refusals; the toast draws the rest, and nothing for an invite one.
  assert.equal(inviteRefusal("refused", "already"), TEAM_WHY.already);
  assert.equal(teamToast("refused", null, null, "already"), null);
  assert.equal(inviteRefusal("refused", "self"), null);
  assert.equal(teamToast("refused", null, null, "self"), TEAM_WHY.self);
  assert.equal(inviteRefusal("invited", "already"), null, "only a refusal");
  // A made-up code reads as before.
  assert.equal(teamToast("refused", null, null, "<b>x</b>"), "That change did not go through. Reload the page and try again.");
  assert.equal(inviteRefusal("refused", "toString"), null, "own keys only");
});

test("the invite mail: the brief's words, no login token, and no nomada tier in agency mode", () => {
  const m = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "editor", agency: false });
  assert.equal(m.subject, "You've been added to the tallyroo.com dashboard");
  assert.match(m.text, /^owner@tallyroo\.com added you to the alwayscited dashboard for tallyroo\.com as an editor\. Sign in with this email address at alwayscited\.com\/app\/login - we'll send you a link\./);
  assert.doesNotMatch(m.text, /token|https?:\/\//);
  const a = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true });
  assert.doesNotMatch(`${a.subject} ${a.text.replace("alwayscited.com/app/login", "")}`, /always(cited|tracked|mentioned|everywhere)|nomada/i);
});

// ---- AG-1 (9 Oct 2026): per-client scope. The writers' order and fail-closed behaviour are in scope.test.mts. ----

test("AG-1: one client on the account invites to every client, as before; two or more default to this client only", () => {
  assert.equal(inviteScope(null, 1), "account");
  assert.equal(inviteScope("client", 1), "account", "a one-client account has nothing else to hide");
  assert.equal(inviteScope("account", 2), "account");
  assert.equal(inviteScope("client", 2), "client");
  assert.equal(inviteScope(null, 2), "client", "no field: this client only");
  assert.equal(inviteScope("everyone", 3), "client", "a garbled field never shows more than meant");
});

test("AG-1: the team on a client is who sees it; someone limited to another client is not 'already' here", () => {
  const scoped: TeamRow[] = [
    row("owner@agency.example", "owner"),
    { ...row("lead@client-a.example", "viewer"), clients: ["A"] },
    { ...row("books@client-b.example", "editor"), clients: ["B"] },
  ];
  assert.deepEqual(onClient(scoped, "A").map((r) => r.email), ["owner@agency.example", "lead@client-a.example"]);
  assert.deepEqual(onClient(scoped, "B").map((r) => r.email), ["owner@agency.example", "books@client-b.example"]);
  assert.ok(refuseInvite({ rows: onClient(scoped, "A"), email: "lead@client-a.example", invitesToday: 0 }), "already sees A");
  assert.equal(refuseInvite({ rows: onClient(scoped, "A"), email: "books@client-b.example", invitesToday: 0 }), null, "on the account for B only, so A can be added");
  assert.ok(refuseChange({ rows: onClient(scoped, "A"), actor: "owner@agency.example", email: "books@client-b.example", op: "remove", role: null }), "Remove on A cannot reach someone who does not see A");
  // The cap is per client: ten who see B do not fill A.
  const b = Array.from({ length: MEMBERS_PER_CLIENT }, (_, i) => ({ ...row(`b${i}@client-b.example`, "viewer"), clients: ["B"] }));
  assert.equal(refuseInvite({ rows: onClient([...scoped, ...b], "A"), email: "new@client-a.example", invitesToday: 0 }), null);
  assert.equal(refuseInvite({ rows: onClient([...scoped, ...b], "B"), email: "new@client-b.example", invitesToday: 0 }), TEAM_WHY.full);
});

test("AG-1: Remove takes the account from an account-wide member, one client from a member with several, and the member with their last", () => {
  assert.equal(removeKind(row("x@agency.example", "editor")), "account");
  assert.equal(removeKind({ ...row("x@agency.example", "editor"), clients: null }), "account");
  assert.equal(removeKind({ ...row("x@client.example", "viewer"), clients: ["A", "B"] }), "client");
  assert.equal(removeKind({ ...row("x@client.example", "viewer"), clients: ["A"] }), "last");
});

test("AG-1: Settings says who sees what only on an account with two or more clients, and Remove says what it takes", () => {
  assert.equal(scopeLine(null, 1, "tallyroo.com"), null);
  assert.equal(scopeLine(null, 3, "tallyroo.com"), "Sees all 3 clients on this account");
  assert.equal(scopeLine(1, 3, "tallyroo.com"), "Sees only tallyroo.com");
  assert.equal(scopeLine(2, 3, "tallyroo.com"), "Sees tallyroo.com and 1 other client");
  assert.equal(scopeLine(3, 4, "tallyroo.com"), "Sees tallyroo.com and 2 other clients");
  assert.equal(removeLine(null, 1, "tallyroo.com"), "They lose access to this dashboard at once.");
  assert.equal(removeLine(null, 2, "tallyroo.com"), "They lose access to both clients on this account at once.");
  assert.equal(removeLine(null, 3, "tallyroo.com"), "They lose access to all 3 clients on this account at once.");
  assert.equal(scopeLine(null, 2, "tallyroo.com"), "Sees both clients on this account");
  assert.equal(removeLine(1, 2, "tallyroo.com"), "They lose access to tallyroo.com at once.");
  assert.equal(removeLine(2, 3, "tallyroo.com"), "They lose access to tallyroo.com at once, and keep the 1 other client they see.");
});

test("AG-1: an invite to every client says so in the mail; an invite to one client reads as before", () => {
  const one = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true, everyClient: null });
  assert.deepEqual(one, inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true }));
  assert.doesNotMatch(one.text, /other client|more/, "names this client only");
  const every = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "editor", agency: false, everyClient: 3 });
  assert.equal(every.subject, "You've been added to the tallyroo.com dashboard and 2 more");
  assert.match(every.text, /^owner@tallyroo\.com added you to the alwayscited dashboard for tallyroo\.com and the 2 other clients on their account, as an editor\. Sign in with this email address at alwayscited\.com\/app\/login - we'll send you a link\./);
  const agency = inviteMail({ inviter: "owner@tallyroo.com", domain: "tallyroo.com", role: "viewer", agency: true, everyClient: 2 });
  assert.match(agency.text, /for tallyroo\.com and the 1 other client on their account, as a viewer/);
  assert.doesNotMatch(`${agency.subject} ${agency.text.replace("alwayscited.com/app/login", "")}`, /always(cited|tracked|mentioned|everywhere)|nomada/i);
});
