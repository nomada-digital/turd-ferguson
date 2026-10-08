import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import TierName from "@/components/TierName";
import { CONTACT_EMAIL } from "@/config/contact";
import { T } from "@/config/tokens";

import { TRIAL } from "@/config/trial";
import { siteHref } from "@/lib/app-host";
import { safeNext } from "@/lib/tracking/next-path";
import { LOGIN_SENT } from "@/lib/tracking/session";

import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

/**
 * Private - noindex here as well as in the layout, the header rule and robots.txt.
 * The sent state has its own title so Next's route announcer reads it when
 * LoginForm moves there with script (R151, 3 Oct 2026).
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<Metadata> {
  const sent = (await searchParams).sent === "1";
  return { title: sent ? "Check your email - alwaystracked" : "Log in - alwaystracked", robots: { index: false, follow: false } };
}

/** Dashboard login (T3, 29 Sep 2026). The link lasts 15 minutes and works once. */
export default async function AppLogin({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const note =
    q.link === "expired"
      ? "That link has expired or was already used. Ask for a new one below."
      : q.access === "none"
        ? // R151 (3 Oct 2026): names where to write instead of "reply to the email you got from us" (NN/g heuristic 6).
          <>
            That address has no dashboard yet. If you think it should, write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: T.accent }}>{CONTACT_EMAIL}</a>.
          </>
        : q.sent === "1"
          ? LOGIN_SENT
          : q.failed === "1"
            ? "Something went wrong. Please try again."
            : q.out === "all"
          ? "You are signed out on every device."
          : q.out === "1"
            ? "You are signed out."
            : null;
  // R151 (3 Oct 2026): once a link is sent the next step is the inbox, so the
  // page says so in its heading and the form below turns secondary, rather
  // than reading exactly as before the send with one plain line added (NN/g
  // heuristic 1, visibility of system status). Both resends land here
  // without script (SendNewLink).
  const sent = q.sent === "1";
  return (
    // No site header or footer here (R104), so the page carries its own lockup.
    <section style={{ maxWidth: "420px", margin: "0 auto", padding: "72px 24px 96px", color: T.ink }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "40px" }}>
        <BrandMark id="app-login" size={15} />
        <TierName tier="tracked" />
      </div>
      <h1 style={{ fontSize: "28px", fontWeight: 700, margin: "0 0 8px" }}>{sent ? "Check your email" : "Log in to your dashboard"}</h1>
      {sent ? (
        <p style={{ margin: "0 0 24px", fontSize: "15px", color: T.ink }}>
          {LOGIN_SENT} It works once, for 15 minutes.
        </p>
      ) : (
        <>
          <p style={{ margin: "0 0 24px", color: T.soft, fontSize: "15px" }}>
            We&apos;ll email you a link. It works once, for 15 minutes.
          </p>
          {note ? <p style={{ margin: "0 0 16px", fontSize: "14px", color: T.ink }}>{note}</p> : null}
        </>
      )}
      {/* R164: where a signed-out visitor was going, carried through the email link. */}
      <LoginForm next={safeNext(q.next) ?? undefined} refused={q.email === "bad"} again={sent} />
      {/* 8 Oct 2026 (audit ia-13): login answered a non-member with nothing but a mailto. Same for members and not, so it reveals no one. */}
      <p style={{ margin: "20px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
        {TRIAL.enabled ? <>No dashboard yet? Start a {TRIAL.days}-day free trial of <TierName tier="tracked" />, card required.</> : <>No dashboard yet? See what <TierName tier="tracked" /> tracks.</>}{" "}
        <a href={siteHref("/alwaystracked")} style={{ color: T.accent, fontWeight: 600 }}>See the plan</a>
      </p>
    </section>
  );
}
