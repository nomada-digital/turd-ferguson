import { appPath } from "../app-host.ts";

/**
 * Where a dashboard route handler sends somebody (M1, 5 Oct 2026).
 *
 * Every writer under /api/app answers a request with no session by sending it
 * to the login page, and the login page is at `/app/login` on the marketing
 * host and `/login` on the dashboard's own. Which one is a property of the
 * deployment rather than of this request - see appPath - so `req` is taken
 * only to keep the call sites reading as redirects and is not inspected.
 *
 * With APP_HOST unset this returns the `/app`-prefixed path it always did.
 */
export function dashPath(_req: Request, rest: string): string {
  return appPath(rest);
}
