/**
 * The address /checkout/done names (R166 part 2, Danny, danny.md line 175):
 * "Check <email> for your sign-in link". Read from the orders row the webhook
 * writes for the Session, never from the URL - an email in a query string
 * lands in request logs (session.ts keeps it out for the same reason).
 *
 * Only a well-formed Session id is looked up. No row yet (the buyer can beat
 * the webhook back), no database, or a failed read all answer null, and the
 * page keeps its "your email" wording: never fatal, and logged.
 *
 * The fixture (the R163 pattern): `CHECKOUT_DONE_FIXTURE_EMAIL` set, with the
 * Session id `fixture`, answers that address so the page can be shot without a
 * real order. With `VERCEL_ENV=production` it throws.
 */
export const DONE_FIXTURE_SESSION = "fixture";

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export type OrderEmailRead = (sessionId: string) => Promise<string | null>;

export async function doneEmail(
  sessionId: string,
  read: OrderEmailRead,
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  const fixture = env.CHECKOUT_DONE_FIXTURE_EMAIL;
  if (fixture && sessionId === DONE_FIXTURE_SESSION) {
    if (env.VERCEL_ENV === "production") {
      throw new Error("CHECKOUT_DONE_FIXTURE_EMAIL is set in production - /checkout/done refuses the fixture");
    }
    return fixture;
  }
  if (!SESSION_ID.test(sessionId)) return null;
  try {
    return await read(sessionId);
  } catch (err) {
    console.warn(`[checkout] could not read the order for /checkout/done: ${(err as Error)?.message ?? "unknown"}`);
    return null;
  }
}
