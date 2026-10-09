import "server-only";
import { Resend } from "resend";
import { CONTACT_EMAIL } from "@/config/contact";
import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";

/**
 * The daily run-health summary to Danny (9 Oct 2026, audit reliability-6,
 * spec OP-1), modelled on the order email and the link alert: to our own
 * contact destination only, never a client. Called only by run-health.ts
 * reportRunHealth through health-io.ts, from a claimed tracking run as it
 * closes and from the CRON_SECRET-gated daily cron, after a
 * dashboard_events claim that makes it one message per tracking day, and
 * only when a client's run is not complete.
 *
 * Returns false rather than throwing; the caller releases its claim.
 */
export async function sendRunHealth(input: { subject: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[track] RESEND_API_KEY is not set, run-health summary not sent");
    return false;
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL,
      subject: headerSafe(input.subject),
      text: input.text,
    });
    if (error) {
      console.error("[track] run-health summary rejected", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[track] run-health summary failed", err);
    return false;
  }
}
