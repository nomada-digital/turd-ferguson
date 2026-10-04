import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Server-side Turnstile verification. Returns true only on an explicit success
 * from Cloudflare: a network failure is a failure, not a pass, or the bot
 * filter can be defeated by making the verify endpoint unreachable.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // An unconfigured Turnstile is only allowed outside production, so that local
  // development works without a Cloudflare account.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[turnstile] refused: TURNSTILE_SECRET_KEY is not set");
      return false;
    }
    return true;
  }
  // Logged with the reason since 4 Oct 2026: every refusal used to be silent,
  // so a client posting no token and Cloudflare rejecting one looked the same.
  if (!token) {
    console.warn("[turnstile] refused: no token posted");
    return false;
  }

  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[turnstile] refused: siteverify answered ${res.status}`);
      return false;
    }
    const json = (await res.json()) as { success?: boolean; "error-codes"?: string[]; hostname?: string };
    if (json.success !== true) {
      console.warn(`[turnstile] refused: ${(json["error-codes"] ?? []).join(",") || "no error code"} host=${json.hostname ?? "-"}`);
    }
    return json.success === true;
  } catch (err) {
    console.warn(`[turnstile] refused: siteverify unreachable (${err instanceof Error ? err.name : "error"})`);
    return false;
  }
}
