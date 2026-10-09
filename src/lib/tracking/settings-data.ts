import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { readScopes, sees } from "./scope.ts";

/**
 * What Settings reads beyond the client row (R142, BRIEF-4 P2, 1 Oct 2026):
 * the names we match and the live members who see this client. The account id
 * is read here and used for the member read only; it never reaches the page.
 *
 * `clients` (AG-1, 9 Oct 2026): how many clients the member is limited to,
 * this one among them, or null when they see every client on the account.
 */
export type Member = { email: string; name: string | null; role: string; last_login_at: string | null; clients: number | null };
/**
 * accountClients: the clients on the account /app can show (a slug set), so
 * Settings can say who sees what and ask an invite's scope when there are two
 * or more. From 8 Oct 2026 (audit security-2) it carried a warning that every
 * member saw them all; members are scoped from 9 Oct (AG-1, scope.ts).
 * scoping: false while dashboard_member_clients is not there yet - everyone
 * then sees every client, and no invite can be limited to one.
 */
export type SettingsData = { aliases: string[]; members: Member[]; accountClients: number; scoping: boolean };

export async function loadSettings(clientId: string): Promise<SettingsData> {
  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("account_id, brand_aliases").eq("id", clientId).single();
  if (cErr) throw new Error(`could not read the client: ${cErr.message}`);
  const { data: rows, error: mErr } = await db
    .from("dashboard_members")
    .select("id, email, name, role, last_login_at")
    .eq("account_id", client.account_id as string)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (mErr) throw new Error(`could not read the team: ${mErr.message}`);
  // AG-1: a member limited to other clients is not on this client's team.
  const scopes = await readScopes(db, (rows ?? []).map((r) => r.id as string));
  const { count, error: nErr } = await db.from("client_domains").select("id", { count: "exact", head: true }).eq("account_id", client.account_id as string).not("slug", "is", null);
  if (nErr) throw new Error(`could not count the account's clients: ${nErr.message}`);
  return {
    accountClients: count ?? 1,
    scoping: scopes.ready,
    aliases: ((client.brand_aliases as string[] | null) ?? []).filter(Boolean),
    members: (rows ?? [])
      .filter((r) => sees(scopes.of.get(r.id as string), clientId))
      .map((r) => ({
        email: r.email as string,
        name: (r.name as string | null) ?? null,
        role: r.role as string,
        last_login_at: (r.last_login_at as string | null) ?? null,
        clients: scopes.of.get(r.id as string)?.length ?? null,
      })),
  };
}
