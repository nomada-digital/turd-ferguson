import { COMPANY_LINE, CONTACT_EMAIL } from "../../config/contact.ts";
import { NEXT_STEPS } from "../../config/onboarding.ts";
import { T } from "../../config/tokens.ts";
import { appUrl } from "../app-host.ts";
import { escapeHtml, shell, type Palette } from "../scan/email-render.ts";
import { TIER_PLAIN, type TierKey } from "../tier-text.ts";

/**
 * The lifecycle emails (R159, Danny, 1 Oct 2026, danny.md lines 159-167), as
 * templates only. Each renders a subject, HTML and plain text from its data.
 * Pure, so the preview page and the tests render them with fixture data and
 * nothing is sent. Nothing here sends: each send site, when wired, checks its
 * own app_settings flag, email_<name>_enabled, which stays false until Danny
 * approves that preview.
 *
 * The rules every template keeps, tested in lifecycle.test.mts: the brand in
 * lowercase; the tier as TIER_PLAIN (no colour in mail); one button; the help
 * block (book a call, email us); the company line in the footer. Receipts,
 * VAT invoices and failed payments are Stripe's, so none of them is here.
 */

export const LIFECYCLE_EMAILS = ["welcome", "setup_reminder", "setup_confirmed", "first_reading", "invite", "plan_ended"] as const;
export type LifecycleEmail = (typeof LIFECYCLE_EMAILS)[number];

/** The app_settings key that turns one on. Default false; only Danny turns one on. */
export const flagFor = (name: LifecycleEmail) => `email_${name}_enabled`;

/** On only for a jsonb true: a missing row, a string or anything else is off. */
export const flagOn = (value: unknown) => value === true;

export type Rendered = { subject: string; html: string; text: string };

const ORIGIN = "https://alwayscited.com";

const P: Palette = { ground: T.bg, card: T.surface, ink: T.ink, body: "#3d4451", quiet: T.soft, line: T.line, accent: T.accent, onAccent: T.surface };
const FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";

/** Book a call goes to /contact with the tier prefilled, as contactUrlFor builds it. */
const callUrl = (tier: TierKey) => `${ORIGIN}/contact?tier=${encodeURIComponent(TIER_PLAIN[tier])}`;

function help(tier: TierKey): { html: string; text: string[] } {
  const call = callUrl(tier);
  return {
    html:
      `Need a hand? <a href="${escapeHtml(call)}" style="color:${P.accent};">Book a call</a> or email ` +
      `<a href="mailto:${CONTACT_EMAIL}" style="color:${P.accent};">${CONTACT_EMAIL}</a>.<br><br>` +
      `alwayscited is run by ${escapeHtml(COMPANY_LINE)}.`,
    text: ["Need a hand?", `Book a call: ${call}`, `Email us: ${CONTACT_EMAIL}`, "", `alwayscited is run by ${COMPANY_LINE}.`],
  };
}

const linkLine = (link: string) =>
  `If the button does nothing, paste this into your browser:<br><span style="color:${P.accent};word-break:break-all;">${escapeHtml(link)}</span>`;

type Parts = { subject: string; preheader: string; heading: string; body: string[]; list?: string[]; cta: { href: string; label: string }; footnote: string; tier: TierKey };

/** Body lines are plain text; this escapes them once for the HTML. */
function render(p: Parts): Rendered {
  const h = help(p.tier);
  const list = p.list?.length
    ? `<ol style="margin:16px 0 0;padding-left:20px;">${p.list.map((l) => `<li style="padding-bottom:6px;">${escapeHtml(l)}</li>`).join("")}</ol>`
    : "";
  const html = shell(P, FONT, {
    title: escapeHtml(p.subject),
    preheader: escapeHtml(p.preheader),
    heading: escapeHtml(p.heading),
    body: p.body.map(escapeHtml).join("<br><br>") + list,
    cta: { href: p.cta.href, label: escapeHtml(p.cta.label) },
    footnote: `${escapeHtml(p.footnote)} ${linkLine(p.cta.href)}`,
    aside: h.html,
  });
  const text = [
    p.heading,
    "",
    ...p.body.flatMap((b) => [b, ""]),
    ...(p.list?.length ? [...p.list.map((l, i) => `${i + 1}. ${l}`), ""] : []),
    `${p.cta.label}: ${p.cta.href}`,
    p.footnote,
    "",
    ...h.text,
  ].join("\n");
  return { subject: p.subject, html, text };
}

/** The 3-step strip, what happens after the welcome; shared with the pages that sell. */
export { NEXT_STEPS };

export function welcome(d: { tier: TierKey; clusters: number; domain: string; link: string }): Rendered {
  const plan = TIER_PLAIN[d.tier];
  return render({
    tier: d.tier,
    subject: "You're in - set up your clusters",
    preheader: `Your ${plan} dashboard for ${d.domain} is ready to set up.`,
    heading: "You're in - set up your clusters",
    body: [`You bought ${plan} for ${d.domain}, with ${d.clusters === 1 ? "1 cluster" : `${d.clusters} clusters`}. Here is what happens next:`],
    list: [...NEXT_STEPS],
    cta: { href: d.link, label: "Set up your clusters" },
    footnote: "The button signs you in. It works once, for 15 minutes; after that, sign in asks for a new link.",
  });
}

export function setupReminder(d: { tier: TierKey; domain: string; link: string }): Rendered {
  return render({
    tier: d.tier,
    subject: "Your clusters aren't set up yet",
    preheader: "Nothing is checked until they are.",
    heading: "Your clusters aren't set up yet",
    body: [`The dashboard for ${d.domain} is waiting on its clusters. Nothing is checked until they are set up.`],
    cta: { href: d.link, label: "Sign in and set up" },
    footnote: "The button signs you in. It works once, for 15 minutes.",
  });
}

export function setupConfirmed(d: { tier: TierKey; clusters: string[]; link: string }): Rendered {
  return render({
    tier: d.tier,
    subject: "Your first check runs tomorrow at 06:00",
    preheader: `${d.clusters.length === 1 ? "1 cluster" : `${d.clusters.length} clusters`} set up.`,
    heading: "Your first check runs tomorrow at 06:00",
    body: ["You chose these clusters:"],
    list: d.clusters,
    cta: { href: d.link, label: "See your dashboard" },
    footnote: "You can change a cluster's prompts from the dashboard at any time.",
  });
}

export function firstReading(d: { tier: TierKey; domain: string; named: number; answers: number; page1: number; keywords: number; link: string }): Rendered {
  return render({
    tier: d.tier,
    subject: `${d.domain}: named in ${d.named} of ${d.answers} answers`,
    preheader: `${d.page1} of ${d.keywords} keywords on page 1 of Google.`,
    heading: "Your first reading is in",
    body: [`In the first check, ${d.domain} was named in ${d.named} of ${d.answers} AI answers, and ${d.page1} of ${d.keywords} keywords are on page 1 of Google.`],
    cta: { href: d.link, label: "See your dashboard" },
    footnote: "The dashboard has every answer, and the pages that were cited instead.",
  });
}

/** Names alwayscited and the tier, so the member route sends it only outside agency mode. */
export function invite(d: { tier: TierKey; domain: string; link: string; inviter: string; role: "editor" | "viewer" }): Rendered {
  return render({
    tier: d.tier,
    subject: `You've been added to the ${d.domain} dashboard`,
    preheader: "Sign in with this email address.",
    heading: `You've been added to the ${d.domain} dashboard`,
    body: [`${d.inviter} added you to the ${d.domain} dashboard as ${d.role === "editor" ? "an editor" : "a viewer"}. Sign in with this email address to see it.`],
    cta: { href: d.link, label: "Sign in" },
    footnote: "Sign in sends a one-time link to this address.",
  });
}

export function planEnded(d: { tier: TierKey; domain: string }): Rendered {
  const plan = TIER_PLAIN[d.tier];
  return render({
    tier: d.tier,
    subject: `Your ${plan} plan has ended`,
    preheader: "Your history is kept.",
    heading: `Your ${plan} plan has ended`,
    body: [`The ${plan} plan for ${d.domain} has ended, so no more checks run. Everything read so far is kept.`, "To restart, pick the plan again; the dashboard picks up where it stopped."],
    cta: { href: `${ORIGIN}/packages`, label: "Restart a plan" },
    footnote: "Stripe sends the final receipt.",
  });
}

/** Fixture data for the preview page and the tests. Made-up domain; never a client. */
export function previews(): Record<LifecycleEmail, Rendered> {
  const link = appUrl("/auth?token=preview-only", ORIGIN);
  const domain = "tallyroo.com";
  return {
    welcome: welcome({ tier: "mentioned", clusters: 3, domain, link }),
    setup_reminder: setupReminder({ tier: "mentioned", domain, link }),
    setup_confirmed: setupConfirmed({ tier: "mentioned", clusters: ["invoicing software", "expense tracking", "payroll for small business"], link: appUrl("/", ORIGIN) }),
    first_reading: firstReading({ tier: "tracked", domain, named: 7, answers: 20, page1: 3, keywords: 10, link: appUrl("/", ORIGIN) }),
    invite: invite({ tier: "tracked", domain, link: appUrl("/login", ORIGIN), inviter: "sam@tallyroo.com", role: "viewer" }),
    plan_ended: planEnded({ tier: "cited", domain }),
  };
}
