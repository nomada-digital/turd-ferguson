import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { type OrderPick, orderKeyword } from "./order-keyword.ts";
import { SETUP_CONFIRMED_EVENT } from "./setup-landing.ts";

/**
 * Whether a client's setup is confirmed (R166 part 3b): one setup_confirmed
 * row in dashboard_events, whoever wrote it. Null when the read failed, so a
 * caller can fall back rather than send a set-up client round again.
 */
export async function loadSetupConfirmed(clientId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin()
    .from("dashboard_events")
    .select("id")
    .eq("client_domain_id", clientId)
    .eq("event", SETUP_CONFIRMED_EVENT)
    .limit(1);
  if (error) {
    console.warn(`[app] could not read the setup state: ${error.message}`);
    return null;
  }
  return (data ?? []).length > 0;
}

/**
 * R180: the typed checkout keyword of this client's newest order, when no scan
 * was behind it (order-keyword.ts). A read only; null when there is none or the
 * read failed, so the field simply opens empty as before.
 */
export async function loadOrderKeyword(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("orders")
    .select("keyword, scan_token")
    .eq("client_domain_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`[app] could not read the order keyword: ${error.message}`);
    return null;
  }
  return orderKeyword((data ?? [])[0] as OrderPick | undefined);
}

/**
 * ON-3 (9 Oct 2026): whether anyone on this client has opened a report or
 * downloaded a CSV - the activation checklist's fourth step. Both are rows the
 * dashboard already records in dashboard_events (usage.ts): `csv` from the
 * report route on every download, and `view` with path /reports from the
 * page's usage beacon. One row of either is enough. Null when a read failed,
 * so the checklist is left out rather than state a step it could not read.
 */
export async function loadReportOpened(clientId: string): Promise<boolean | null> {
  const db = supabaseAdmin();
  const [{ data: csv, error: csvErr }, { data: view, error: viewErr }] = await Promise.all([
    db.from("dashboard_events").select("id").eq("client_domain_id", clientId).eq("event", "csv").limit(1),
    db.from("dashboard_events").select("id").eq("client_domain_id", clientId).eq("event", "view").eq("path", "/reports").limit(1),
  ]);
  const error = csvErr ?? viewErr;
  if (error) {
    console.warn(`[app] could not read whether a report was opened: ${error.message}`);
    return null;
  }
  return (csv ?? []).length > 0 || (view ?? []).length > 0;
}
