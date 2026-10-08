import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * What Settings reads beyond the client row (R142, BRIEF-4 P2, 1 Oct 2026):
 * the names we match and the account's live members. The account id is read
 * here and used for the member read only; it never reaches the page.
 */
export type Member = { email: string; name: string | null; role: string; last_login_at: string | null };
/**
 * accountClients (8 Oct 2026, audit security-2): a member sees every client on
 * the account, so a team of an account with several clients sees them all.
 * Settings says so where invites are made, until members can be scoped.
 */
export type SettingsData = { aliases: string[]; members: Member[]; accountClients: number };

export async function loadSettings(clientId: string): Promise<SettingsData> {
  const db = supabaseAdmin();
  const { data: client, error: cErr } = await db.from("client_domains").select("account_id, brand_aliases").eq("id", clientId).single();
  if (cErr) throw new Error(`could not read the client: ${cErr.message}`);
  const { data: rows, error: mErr } = await db
    .from("dashboard_members")
    .select("email, name, role, last_login_at")
    .eq("account_id", client.account_id as string)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (mErr) throw new Error(`could not read the team: ${mErr.message}`);
  const { count, error: nErr } = await db.from("client_domains").select("id", { count: "exact", head: true }).eq("account_id", client.account_id as string);
  if (nErr) throw new Error(`could not count the account's clients: ${nErr.message}`);
  return {
    accountClients: count ?? 1,
    aliases: ((client.brand_aliases as string[] | null) ?? []).filter(Boolean),
    members: (rows ?? []).map((r) => ({ email: r.email as string, name: (r.name as string | null) ?? null, role: r.role as string, last_login_at: (r.last_login_at as string | null) ?? null })),
  };
}
