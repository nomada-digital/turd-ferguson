import "server-only";
import { Resend } from "resend";
import { CONTACT_EMAIL } from "@/config/contact";
import { mailFrom } from "@/config/mail-from";
import type { TierKey } from "@/components/TierName";
import { headerSafe } from "@/lib/email-header";
import { setupConfirmed } from "@/lib/email/lifecycle";
import { lifecycleOn, sendLifecycle } from "@/lib/email/lifecycle-mail";
import { siteUrl } from "@/lib/scan/verify-email";
import { appUrl } from "@/lib/app-host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TIER_PLAIN } from "@/lib/tier-text";
import { upsellMode } from "./ask.ts";
import { trackingDay } from "./decide.ts";

/**
 * Setup confirmed (R166 step 4, Danny, danny.md line 175): one internal
 * message to our own contact destination when a client's owner or editor
 * presses Confirm on /app/[client]/setup - never to the client. Sent only by
 * the setup route, after it writes the one setup_confirmed row; a client
 * already confirmed writes nothing and sends nothing, so it is once a client.
 * The member is the reply-to.
 *
 * Returns false rather than throwing; the confirm stands either way.
 */
export async function sendSetupConfirmed(input: {
  domain: string;
  slug: string;
  tier: string;
  member: string;
  /** R166 part 5: a keyword a setup card checked and passed, verified by the route; not yet set on the cluster. */
  checked?: { cluster: string; keyword: string; volume: number; intent: string } | null;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[app] RESEND_API_KEY is not set, setup mail not sent");
    return false;
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL,
      replyTo: input.member,
      subject: headerSafe(`Setup confirmed: ${input.domain}`),
      text: [
        `${input.member} confirmed setup for ${input.domain} (tier: ${input.tier}).`,
        "",
        `Their clusters and prompts are as shown on /app/${input.slug}/clusters and in /admin/tracking.`,
        ...(input.checked
          ? [
              "",
              `They checked a keyword for the cluster "${input.checked.cluster}": ${input.checked.keyword} (${input.checked.volume.toLocaleString("en-GB")} searches a month, ${input.checked.intent} intent). It passed; set it on the cluster by hand.`,
            ]
          : []),
      ].join("\n"),
    });
    if (error) {
      console.error("[app] setup mail rejected", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[app] setup mail failed", err);
    return false;
  }
}

/**
 * R159's setup_confirmed (danny.md line 163): the client's own lifecycle mail,
 * to the member who pressed Confirm, naming the clusters they set up. Called
 * by the setup route only after it writes the one setup_confirmed row, so it
 * is once a client. Only when its flag is on (off until Danny approves it)
 * and never in agency mode (the email names alwayscited and the tier). Never
 * fatal: the confirm stands either way.
 */
export async function mailSetupConfirmed(clientId: string, member: string): Promise<void> {
  try {
    const db = supabaseAdmin();
    if (!(await lifecycleOn(db, "setup_confirmed"))) return;
    const { data: c, error: cErr } = await db.from("client_domains").select("account_id, tier, market, started_on").eq("id", clientId).single();
    if (cErr) throw new Error(cErr.message);
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", c.account_id).maybeSingle();
    if (aErr || !account) throw new Error(aErr?.message ?? "no account");
    if (upsellMode(account.upsell_mode) === "agency") return;
    const { data: clusters, error: clErr } = await db.from("tracked_clusters").select("name").eq("client_domain_id", clientId).is("stopped_on", null).order("created_at", { ascending: true });
    if (clErr) throw new Error(clErr.message);
    const tier = ((c.tier as string) in TIER_PLAIN ? c.tier : "tracked") as TierKey;
    // 9 Oct 2026 (audit copy-2): the check time in the client's zone, and no "first" check once checks have begun.
    const mail = setupConfirmed({ tier, clusters: (clusters ?? []).map((k) => k.name as string), link: appUrl("/", siteUrl()), market: (c.market as string | null) ?? "US", today: trackingDay(), startedOn: (c.started_on as string | null) ?? null });
    if (!(await sendLifecycle({ memberEmail: member, mail }))) console.warn("[app] setup_confirmed not sent");
  } catch (err) {
    console.warn(`[app] setup_confirmed skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
