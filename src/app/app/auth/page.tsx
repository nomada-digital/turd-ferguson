import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import TierName from "@/components/TierName";
import { T } from "@/config/tokens";
import SubmitButton from "@/components/app/SubmitButton";
import { NEXT_MAX, safeNext } from "@/lib/tracking/next-path";
import { trackingRepo } from "@/lib/tracking/repo";
import { TOKEN_CHARS, isTokenShape } from "@/lib/tracking/session";

import AutoSubmit from "./AutoSubmit";
import SendNewLink from "./SendNewLink";
import { appPath } from "@/lib/app-host";

export const dynamic = "force-dynamic";

/** Private - noindex here as well as in the layout, the header rule and robots.txt. */
export const metadata: Metadata = {
  title: "Log in - alwaystracked",
  robots: { index: false, follow: false },
};

const BUTTON = { display: "inline-flex", alignItems: "center", gap: "8px", padding: "12px 16px", borderRadius: "10px", border: "none", background: T.accent, color: "#ffffff", fontWeight: 600, fontSize: "15px" } as const;

/**
 * Where the login link lands (T3). The GET spends nothing: mail scanners open
 * links on delivery, so the single-use token is spent by the form below, a
 * POST. R163 (1 Oct 2026, danny.md line 172): with script that form submits
 * itself on load; without, the button is there. The GET reads the token's
 * state first, so a spent or expired link offers a new one in one click
 * instead of posting into a failure. `failed=1` is the POST's own way back
 * here, so a claim that failed for any other reason shows the button rather
 * than submitting again in a loop.
 */
export default async function AppAuth({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token, failed, next: rawNext } = await searchParams;
  const next = safeNext(rawNext);
  const shaped = isTokenShape(token);
  const link = shaped ? await trackingRepo().linkState(token) : null;
  const ok = shaped && (link === null || link.state === "fresh");
  const spent = link?.state === "spent" ? link : null;
  const auto = ok && link?.state === "fresh" && failed !== "1";
  return (
    <section style={{ maxWidth: "420px", margin: "0 auto", padding: "72px 24px 96px", color: T.ink }}>
      {/* R148 pass 6 (1 Oct 2026): the same lockup /app/login carries, since neither has the site header. */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "40px" }}>
        <BrandMark id="app-auth" size={15} />
        <TierName tier="tracked" />
      </div>
      <h1 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 16px" }}>
        {ok ? "Log in" : spent ? "That link has already been used" : "That link is not valid"}
      </h1>
      {ok ? (
        <form method="post" action="/api/app/auth">
          {/* R151 (3 Oct 2026): failed=1 on a link that is still good was a bare "Log in" - the claim or session write failed, and nothing said so (NN/g heuristic 9). */}
          {failed === "1" ? (
            <p role="alert" style={{ margin: "0 0 24px", color: T.badFg, fontSize: "15px" }}>
              That did not open your dashboard. Try again, or{" "}
              <a href={appPath("/login")} style={{ color: T.accent, fontWeight: 600 }}>
                ask for a new link
              </a>
              .
            </p>
          ) : null}
          <input type="hidden" name="token" value={token} maxLength={TOKEN_CHARS} />
          {next ? <input type="hidden" name="next" value={next} maxLength={NEXT_MAX} /> : null}
          <SubmitButton busy="Opening your dashboard..." style={BUTTON}>
            Open my dashboard
          </SubmitButton>
          {auto ? <AutoSubmit /> : null}
        </form>
      ) : spent ? (
        <>
          <p style={{ margin: "0 0 24px", color: T.soft, fontSize: "15px" }}>Each link works once, for 15 minutes.</p>
          <SendNewLink email={spent.email} />
        </>
      ) : (
        // R148 pass 6 (1 Oct 2026): was a 21px text link, the only way on; now a 48px button-shaped link like "Open my dashboard".
        <a
          href={appPath("/login")}
          style={{ display: "inline-block", padding: "12px 16px", borderRadius: "10px", background: T.accent, color: "#ffffff", fontWeight: 600, fontSize: "15px", textDecoration: "none" }}
        >
          Ask for a new link
        </a>
      )}
    </section>
  );
}
