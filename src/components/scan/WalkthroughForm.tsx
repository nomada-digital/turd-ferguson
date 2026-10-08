"use client";

import { useEffect, useState } from "react";

import { SCAN_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { track } from "@/lib/analytics";
import type { WalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";
import { isWorkEmail, WORK_EMAIL_REFUSAL } from "@/lib/work-email";

import { btn, field, label } from "./screens";

/**
 * The walkthrough ask, in its own file because two surfaces make it.
 *
 * It was declared inside `ResultView` and used once, which was right while the
 * scan report was the only page with a call to action. The campaign benchmark
 * is the second: a PR agency that has just read which of its placements the
 * engines cited is being asked the same question - do you want to see the
 * dashboards - and copying the form there would have been two forms posting to
 * one endpoint, drifting apart a field at a time.
 *
 * `token` is a **scans** token, not a campaign one. `/api/scan/[token]/walkthrough`
 * looks the row up by `scans.public_token`, and a campaign's own public token
 * will 404 against it. The benchmark reading passes its reading's scan token
 * for that reason - see `readCampaign`, which selects it.
 *
 * The ask itself, since 24 September 2026. Danny: the result should lead into
 * alwaystracked, and the CTA is purely a walkthrough - a Loom of the platform
 * or a demo call with him. alwaystracked is set up per client rather than
 * self-serve today, so "see it" means somebody shows you.
 *
 * What this must keep straight: alwaystracked reports, it does not place. The
 * placements are alwaysmentioned, which is a service.
 *
 * The third surface, 28 September 2026 (pricing spec section 6, Danny,
 * danny.md line 55): every tier page, where there is no scan. Pass `from` (the
 * tier page's path) instead of `token` and it posts to `/api/walkthrough`,
 * which stores the ask with no scan. Without JS that version renders nothing -
 * the page's own "Book a call" link stands in, since a form that cannot post
 * would only lose the address.
 *
 * Two options, not three (R176, Danny, 1 Oct 2026, danny.md lines 190-208):
 * R54's "Book a call" link to /contact is gone from the toggle (every other
 * Book a call on the site stays). The two name who does it - "Loom with Luke",
 * "Demo with Danny" - each with a 24px round photo before its label.
 */
export default function WalkthroughForm(p: { token: string; back?: string; outcome?: WalkthroughOutcome | null } | { from: string }) {
  const token = "token" in p ? p.token : null;
  // R151 (3 Oct 2026): the scan version posts without script as well, and the
  // route's 303 brings back only `outcome`, which the page passes in.
  const outcome = "token" in p ? (p.outcome ?? null) : null;
  const [mounted, setMounted] = useState(token !== null);
  useEffect(() => setMounted(true), []);
  const [kind, setKind] = useState<"video" | "demo">(outcome === "demo" ? "demo" : "video");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(outcome === "bad" ? "That email does not look right." : outcome === "personal" ? WORK_EMAIL_REFUSAL : outcome === "failed" ? "That did not go through. Please try again." : "");
  const [done, setDone] = useState(outcome === "video" ? "Thanks. Luke will send your Loom." : outcome === "demo" ? "Thanks. Danny will be in touch." : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim() && !isWorkEmail(email)) {
      setErr(WORK_EMAIL_REFUSAL);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const headers = new Headers();
      headers.set("content-type", "application/json");
      // Two literal calls, not one with a computed path: route-callers reads
      // each fetch's own first argument to join it to the route that answers.
      const res = token
        ? await fetch("/api/scan/" + token + "/walkthrough", {
            method: "POST",
            headers,
            body: JSON.stringify({ email, kind }),
          })
        : await fetch("/api/walkthrough", {
            method: "POST",
            headers,
            body: JSON.stringify({ email, kind, from: "from" in p ? p.from : "" }),
          });
      const data = await res.json();
      if (!res.ok && res.status !== 429) {
        setErr(data.message ?? "That did not go through. Please try again.");
        return;
      }
      setDone(data.message ?? (kind === "video" ? "Thanks. Luke will send your Loom." : "Thanks. Danny will be in touch."));
      track("walkthrough_requested", { kind });
    } catch {
      setErr("We could not reach the checker. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  if (done) {
    return (
      <p id="walkthrough" aria-live="polite" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.ink }}>
        {done}
      </p>
    );
  }

  // ScanResult.dc.html's switch: short labels on a grey track, and the chosen
  // one's note under it rather than inside each option.
  const options: { key: "video" | "demo"; title: string; photo: string; note: string }[] = [
    {
      key: "video",
      title: "Loom with Luke",
      photo: "/team/luke.webp",
      note: token ? "Luke records a Loom of the platform against this report." : "Luke records a Loom of the platform for you.",
    },
    { key: "demo", title: "Demo with Danny", photo: "/team/danny.webp", note: "Danny takes you through it on a call." },
  ];
  const chosen = options.find((o) => o.key === kind) ?? options[0];

  // R151 (1 Oct 2026): the WAI-ARIA APG radio group - one tab stop, the
  // checked option, and the arrows (Home, End) move the choice and focus with
  // it. Separate tab stops read as separate buttons, not one choice.
  function onToggleKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    const at = options.findIndex((o) => o.key === kind);
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % options.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at - 1 + options.length) % options.length
      : e.key === "Home" ? 0
      : e.key === "End" ? options.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    setKind(options[to].key);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  }

  return (
    <form id="walkthrough" action={token ? "/api/scan/" + token + "/walkthrough" : undefined} method="post" onSubmit={submit} noValidate>
      <input type="hidden" id="wt-kind" name="kind" value={kind} />
      {"token" in p && p.back ? <input type="hidden" id="wt-back" name="back" value={p.back} /> : null}
      <div role="radiogroup" aria-label="How would you like to see it" className="wt-toggle">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={kind === o.key}
            tabIndex={kind === o.key ? 0 : -1}
            onKeyDown={onToggleKey}
            onClick={() => setKind(o.key)}
            className={"wt-option" + (kind === o.key ? " wt-option--on" : "")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 24px, sized in the tag, no layout shift */}
            <img src={o.photo} width={24} height={24} alt="" />
            {o.title}
          </button>
        ))}
      </div>
      <p aria-live="polite" style={{ margin: "14px 0 0", fontSize: "13.5px", lineHeight: 1.5, color: T.soft, minHeight: "42px" }}>
        {chosen.note}
      </p>
      <label htmlFor="wt-email" style={{ ...label, marginTop: "14px", display: "block" }}>
        Work email
      </label>
      <input
        id="wt-email"
        type="email"
        name="email"
        autoComplete="email"
        maxLength={SCAN_LIMITS.email}
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={field}
        aria-invalid={Boolean(err)}
        aria-describedby={err ? "wt-error" : undefined}
      />
      {err ? (
        <p id="wt-error" role="alert" style={{ fontSize: "13px", color: T.badFg, marginTop: "8px" }}>
          {err}
        </p>
      ) : null}
      <button type="submit" className="btn-primary" style={{ ...btn, width: "100%", marginTop: "12px" }} disabled={busy}>
        {busy ? "Sending" : kind === "video" ? "Send me the walkthrough" : "Request a demo"}
      </button>
      <p style={{ fontSize: "12px", color: T.soft, marginTop: "10px", lineHeight: 1.5 }}>
        We use it to send you the walkthrough or arrange the call, and nothing else. <a href="/legal">What we collect</a>.
      </p>
    </form>
  );
}
