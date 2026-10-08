import { isPlausibleEmail, normalizeEmail } from "./email-address.ts";

/**
 * Work email only, on every public submission (Danny, 8 Oct 2026).
 *
 * Every form on the site labelled the field "Work email" and then only checked
 * the address was plausible. This is the rule the label promised. Checkout is
 * the one door it does not stand at - a buyer can pay with any address - and
 * the /app login and team invites are not public submissions at all, so
 * existing members keep signing in with whatever address they have.
 * `work-email.test.mts` holds the census of which handlers call it.
 *
 * Plain module, relative import, so `node --test` loads the real function and
 * the client forms run the same check the server does. The extra domains Danny
 * can add without a deploy (`app_settings.work_email_blocked_extra`) are a
 * server read, passed in as `extra`; a form with script checks the built-in
 * list and the server checks both.
 */

/** The refusal, on the email field, in Danny's wording. */
export const WORK_EMAIL_REFUSAL = "Use your work email - we don't accept Gmail, Outlook or other personal addresses.";

/** Whole domains: consumer mail, UK and US ISP mail, disposable inboxes. */
const BLOCKED_DOMAINS: ReadonlySet<string> = new Set([
  // consumer
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com", "aol.com", "aim.com", "msn.com",
  "proton.me", "protonmail.com", "pm.me", "mail.com", "zoho.com", "zohomail.com", "tutanota.com", "tuta.io",
  "fastmail.com", "hey.com", "duck.com", "qq.com", "163.com", "126.com", "naver.com", "mail.ru",
  "ymail.com", "rocketmail.com",
  // web.de is GMX's consumer mail. `web` is not a first-label rule below,
  // because web.com is a company (Web.com Group) and its staff mail from it.
  "web.de",
  // UK and US ISP mail
  "btinternet.com", "sky.com", "virginmedia.com", "talktalk.net", "ntlworld.com", "blueyonder.co.uk",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "cox.net", "charter.net", "earthlink.net",
  // disposable
  "mailinator.com", "guerrillamail.com", "sharklasers.com", "10minutemail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc",
]);

/**
 * Providers that run the same consumer mail under many country domains -
 * hotmail.co.uk, yahoo.fr, gmx.de, outlook.com.br, live.com.au.
 *
 * Matched only where the provider name is followed by nothing but a suffix
 * (`.fr`, `.co.uk`, `.com.au`), not as the first label of any domain at all:
 * `name@outlook.company.com` is a company's own subdomain and stays accepted.
 * `live` is kept on that shape because every live.<suffix> mail domain is
 * Microsoft's consumer service; `web` is not, see web.de above.
 */
const BLOCKED_PROVIDERS: ReadonlySet<string> = new Set(["hotmail", "outlook", "live", "yahoo", "gmx", "yandex"]);

/** The second-level labels a country suffix is built from: co.uk, com.au, net.br. */
const SUFFIX_SECOND = new Set(["co", "com", "net", "org", "ne", "or"]);

function isProviderDomain(labels: readonly string[]): boolean {
  if (!BLOCKED_PROVIDERS.has(labels[0])) return false;
  if (labels.length === 2) return true;
  return labels.length === 3 && SUFFIX_SECOND.has(labels[1]) && labels[2].length === 2;
}

/**
 * Whether this address can be used on a public form: plausible, and not a
 * personal, ISP or disposable inbox. `extra` is the comma-separated list from
 * `app_settings`, already split; a domain there is refused whole.
 */
export function isWorkEmail(raw: string, extra: readonly string[] = []): boolean {
  const email = normalizeEmail(raw);
  if (!isPlausibleEmail(email)) return false;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (extra.includes(domain)) return false;
  return !isProviderDomain(domain.split("."));
}

/** `work_email_blocked_extra` as stored - comma-separated text - into domains. */
export function parseBlockedExtra(value: unknown): string[] {
  const parts = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  const domains = parts
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return [...new Set(domains)];
}
