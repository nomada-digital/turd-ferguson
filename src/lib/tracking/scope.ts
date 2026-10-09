import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-client member scoping (AG-1, audit security-2, launch blocker LB2;
 * 9 Oct 2026). A dashboard member belongs to an account, and until now saw
 * every client on it - so an agency inviting its client's marketing lead "to
 * this dashboard" showed them the agency's other clients too.
 *
 * `dashboard_member_clients` (20261009010000_member_clients.sql) limits a
 * member to the clients it lists. The rule, everywhere it is read:
 *
 * - no live row for a member: every client on the account - owners, agency
 *   staff, and every member made before the table existed;
 * - live rows: only those clients.
 *
 * So a live member must never be left with all their rows removed - that
 * reads as every client. Removing a member's last client removes the member
 * (team.ts removeMember), and an invite writes the scope before the member's
 * row goes live (team.ts invite). A member's rows are cleared only while the
 * member is not live - the first write of an invite - or to widen them on
 * purpose: an invite to every client, an owner made in /admin/tracking. A
 * removal leaves them: nothing reads a removed member's scope, and a clear
 * after the removal could land after an invite had made them live again
 * (AG-1 review, 9 Oct 2026). Owners are never limited: an owner invites only
 * editors and viewers, and /admin/tracking clears the scope of anyone it
 * makes an owner.
 *
 * Rows are never deleted: removal sets removed_at, as dashboard_members does,
 * and every read and update requires removed_at is null (members-live.test.mts).
 *
 * Until the migration is applied the table does not exist. A read then answers
 * "no rows" - the truth, as everyone sees every client - and says the table is
 * missing, so Settings offers no one-client invite. Any other failed read
 * throws: a scope read that fails must never widen what a member sees.
 */

/** The clients a member is limited to, or null for every client on the account. */
export type ClientScope = readonly string[] | null;

/** What an invite grants: this client only, or every client on the account. */
export type InviteScope = "client" | "account";

/** Whether a member with this scope sees this client. Undefined is no rows: every client. */
export function sees(scope: ClientScope | undefined, clientId: string): boolean {
  return scope == null || scope.includes(clientId);
}

/**
 * Whether a failed read or write was only the table not being there yet - a
 * deploy that lands before its additive migration (AGENTS.md). PostgREST says
 * PGRST205 "Could not find the table 'public.dashboard_member_clients' in the
 * schema cache"; Postgres says 42P01 'relation ... does not exist'. A missing
 * column is 42703 and is not this.
 */
export function scopeTableMissing(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err || typeof err.message !== "string" || !err.message.includes("dashboard_member_clients")) return false;
  return err.code === "PGRST205" || err.code === "42P01" || /could not find the table|relation "[^"]*" does not exist/i.test(err.message);
}

/** Live scope rows grouped by member. A member absent from the map sees every client. */
export function scopesFrom(rows: readonly { member_id: unknown; client_domain_id: unknown }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const id = String(r.member_id);
    out.set(id, [...(out.get(id) ?? []), String(r.client_domain_id)]);
  }
  return out;
}

/**
 * The clients a member's memberships show, each with the role on its account
 * (clientsFor's join, pure so the scope is tested). One membership per account
 * (unique account_id, email); a client on an account the email is not on, or
 * outside a limited member's scope, is not returned. The row is handed back as
 * it came, never spread, so the caller names the fields it returns.
 */
export function visibleClients<C extends { id: string; account_id: string }>(
  memberships: readonly { id: string; account_id: string; role: string }[],
  scopes: ReadonlyMap<string, readonly string[]>,
  clients: readonly C[],
): { client: C; role: string }[] {
  const byAccount = new Map(memberships.map((m) => [m.account_id, m]));
  return clients.flatMap((client) => {
    const m = byAccount.get(client.account_id);
    return m && sees(scopes.get(m.id), client.id) ? [{ client, role: m.role }] : [];
  });
}

export type Scopes = {
  /** Live scope by member id; a member not in it sees every client. */
  of: Map<string, string[]>;
  /** False while the table is not there yet: nobody is limited, and no one-client invite can be written. */
  ready: boolean;
};

/**
 * The live scope of each member. Throws on a failed read, except the table
 * not existing yet, which is no rows. With no ids there is nothing to read,
 * and ready says true.
 */
export async function readScopes(db: SupabaseClient, memberIds: readonly string[]): Promise<Scopes> {
  if (!memberIds.length) return { of: new Map(), ready: true };
  const { data, error } = await db.from("dashboard_member_clients").select("member_id, client_domain_id").in("member_id", [...memberIds]).is("removed_at", null);
  if (error) {
    if (scopeTableMissing(error)) return { of: new Map(), ready: false };
    throw new Error(`could not read who sees which client: ${error.message}`);
  }
  return { of: scopesFrom(data ?? []), ready: true };
}

/** Add one client to a member's scope, or bring a removed row back. An error's words, or null. */
export async function addScope(db: SupabaseClient, p: { memberId: string; clientId: string; by: string }): Promise<string | null> {
  const { error } = await db
    .from("dashboard_member_clients")
    .upsert({ member_id: p.memberId, client_domain_id: p.clientId, added_by: p.by, removed_at: null, removed_by: null }, { onConflict: "member_id,client_domain_id" });
  return error ? error.message : null;
}

/**
 * Take one client off a member's scope. Only for a member who keeps another
 * client: taking the last one would leave them seeing every client, so
 * removeMember removes the member instead.
 */
export async function dropScope(db: SupabaseClient, p: { memberId: string; clientId: string; by: string }): Promise<string | null> {
  const { error } = await db
    .from("dashboard_member_clients")
    .update({ removed_at: new Date().toISOString(), removed_by: p.by })
    .eq("member_id", p.memberId)
    .eq("client_domain_id", p.clientId)
    .is("removed_at", null);
  return error ? error.message : null;
}

/**
 * Every live scope row of a member removed, so a live member then sees every
 * client. Called while the member is not live (an invite's first write, so a
 * removed member carries no old scope back), or to widen a live one on
 * purpose (an invite to every client, an owner made in /admin/tracking).
 * With the table not there yet there is nothing to clear.
 */
export async function clearScope(db: SupabaseClient, p: { memberId: string; by: string }): Promise<string | null> {
  const { error } = await db
    .from("dashboard_member_clients")
    .update({ removed_at: new Date().toISOString(), removed_by: p.by })
    .eq("member_id", p.memberId)
    .is("removed_at", null);
  return error && !scopeTableMissing(error) ? error.message : null;
}
