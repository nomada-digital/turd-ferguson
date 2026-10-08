"use server";

import { Resend } from "resend";

import { CONTACT_EMAIL, WAITLIST_LIMITS as LIMITS } from "@/config/contact";
import { mailFrom } from "@/config/mail-from";
import { isPlausibleEmail } from "@/lib/email-address";
import { headerSafe } from "@/lib/email-header";
import { isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";
import { isWorkEmail, WORK_EMAIL_REFUSAL } from "@/lib/work-email";
import { workEmailBlockedExtra } from "@/lib/work-email-server";

/**
 * Pre-launch capture, used only while the live scan is unconfigured.
 *
 * It deliberately produces no result of any kind. Showing an anonymous visitor
 * a fabricated verdict about their own brand is worse than showing them
 * nothing, so this takes the domain and the address and says plainly that a
 * person will run it.
 *
 * Every value below is typed by a stranger into a form with no captcha, and
 * this action treats them as hostile for the same reasons the contact action
 * does. It did not until 20 September 2026:
 *
 *  - It put an unbounded stranger string in a mail subject. This is the real
 *    hole and it was measured rather than argued: a 5,000-character path
 *    produced a 5,026-character subject line, where the same input now produces
 *    25. `headerSafe` exists for precisely this and both other senders in the
 *    tree already called it. A newline could not get through - the "." in the
 *    old regex's path group does not match a line terminator, and `trim` ate
 *    the trailing case that "$" would otherwise have allowed - so the injection
 *    half was already shut and the bound half was never there.
 *  - It bounded no field at all, where the contact action bounds every one.
 *    `email` becomes a reply-to header; `topic` goes in the body.
 *  - It hand-rolled a domain regex rather than using `normalizeDomain` and
 *    `isPlausibleDomain`, the tested pair the live scan path uses. Two
 *    validators for one field is the defect this repo keeps finding in its
 *    numbers, and these two disagreed in both directions: the regex took a
 *    whole URL with its path into the subject, and refused
 *    "https://user:pass@example.com/path" and
 *    "https://example.com?email=me@other.com", which the live path accepts and
 *    normalises. So a domain the funnel would have scanned was turned away
 *    here, and the pair's two documented fixes - the "@" in a query string and
 *    the backslash in an authority, each of which resolves to one host in a
 *    browser and used to normalise to another - applied to one of the two
 *    places this site reads a domain from a stranger.
 *
 * What none of this was: a test failing. `contact.test.mts` sweeps the contact
 * action's fields for exactly this species and reads one file.
 * `email-header.test.mts` is the version of it that reads every sender.
 *
 * It also had no honeypot while the contact action did, which is the same
 * two-copies defect one field along: one public form guarded, the other not,
 * with nothing anywhere holding that they are the same kind of door. Both are
 * now in `mail-doors.test.mts`, which derives its list by walking for
 * `"use server"` rather than by naming these two - `spend-gates.test.mts`
 * cannot see either of them, because it walks `src/app/api` for `route.ts` and
 * a server action is neither.
 */
export type WaitlistResult = { ok: true } | { ok: false; message: string };

const clamp = (v: string, max: number) => v.slice(0, max);

export async function requestScan(input: {
  domain: string;
  email: string;
  topic: string;
  /** The honeypot. Rendered, hidden, and never filled by a person. */
  website?: string;
}): Promise<WaitlistResult> {
  /**
   * Clamp before anything looks at the value, so no branch below - including a
   * refusal, which logs - ever holds an unbounded string. The inputs carry
   * these as maxLength too, so a visitor is stopped at the field; a post that
   * never rendered the page is stopped here.
   */
  const domain = normalizeDomain(clamp(input.domain, LIMITS.domain));
  const email = clamp(input.email, LIMITS.email).trim();
  const topic = clamp(input.topic, LIMITS.topic).trim();
  const website = clamp(input.website ?? "", LIMITS.website).trim();

  /**
   * The honeypot, answered before the field checks rather than after.
   *
   * Ordered that way on purpose: a bot that fills every field also fills the
   * real ones, so a refusal for a bad domain would reach it first and tell it
   * which field it got wrong. It gets a success instead, for the reason the
   * contact action gives - an error names the field that gave them away.
   *
   * Logged, because a hidden field that silently eats a real request looks
   * exactly like one that is working. Already clamped above; it is
   * attacker-controlled by definition and it is going into a function log.
   */
  if (website) {
    console.warn("[waitlist] honeypot filled, not sending", { email, website });
    return { ok: true };
  }

  if (!isPlausibleDomain(domain)) {
    return { ok: false, message: "Enter a domain, like client-domain.com" };
  }
  // The shared pair for the address, beside the shared pair for the domain one
  // line up. This file's own header records that two validators for one field is
  // "the defect this repo keeps finding in its numbers" and then kept a second
  // one for the field beside it - the email check was a private copy the whole
  // time the comment above was describing the domain fix.
  if (!isPlausibleEmail(email)) {
    return { ok: false, message: "That email address does not look right." };
  }
  if (!isWorkEmail(email, await workEmailBlockedExtra())) {
    return { ok: false, message: WORK_EMAIL_REFUSAL };
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // No silent success. If we cannot record the request, we say so.
    console.error("[waitlist] RESEND_API_KEY is not set, request not recorded");
    return { ok: false, message: `We could not record that just now. Please email ${CONTACT_EMAIL}.` };
  }

  try {
    /**
     * The SDK does not throw for a rejected send.
     *
     * A non-2xx, an unparseable error body and a failed fetch all resolve
     * with a null data and an error object, so the catch below covers almost
     * nothing and awaiting the call was never the same as checking it. An
     * unverified sending domain, a rate limit or a suppressed recipient came
     * back here as success, and this returned ok to a visitor whose request
     * had gone nowhere and whom nobody was going to email.
     *
     * The comment at the top of this file says no silent success, and this
     * was the one path in the tree that had one: the contact action and both
     * scan emails read the returned error already.
     */
    const dispatch = await new Resend(key).emails.send({
      from: mailFrom(),
      to: process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL,
      replyTo: email,
      subject: headerSafe(`Scan request: ${domain}`),
      text: [
        `Domain: ${domain}`,
        `Topic:  ${topic || "(not given)"}`,
        `Email:  ${email}`,
        "",
        "Sent from the domain field while the live scan is switched off.",
      ].join("\n"),
    });
    if (dispatch.error) {
      console.error("[waitlist] send rejected", dispatch.error);
      return { ok: false, message: `We could not record that just now. Please email ${CONTACT_EMAIL}.` };
    }
  } catch (e) {
    console.error("[waitlist] send failed", e);
    return { ok: false, message: `We could not record that just now. Please email ${CONTACT_EMAIL}.` };
  }

  return { ok: true };
}
