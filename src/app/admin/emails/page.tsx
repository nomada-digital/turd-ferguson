import type { Metadata } from "next";

import { TRACKED_PRICE } from "@/config/pricing";
import { T } from "@/config/tokens";
import { flagFor, LIFECYCLE_EMAILS, previewSets } from "@/lib/email/lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Emails",
  robots: { index: false, follow: false },
};

/** The two widths Danny reads each preview at (R159). */
const WIDTHS = [
  { label: "Desktop", px: 640 },
  { label: "Phone", px: 390 },
];

/**
 * /admin/emails - R159 part 2 (Danny, 1 Oct 2026, danny.md lines 159-167).
 * Behind the /admin Basic auth in proxy.ts. Each lifecycle email rendered on
 * made-up fixture data (lifecycle.ts previews()) at desktop and phone width,
 * with its subject, its plain text and the flag that turns it on. Reads
 * nothing and sends nothing; each flag stays false until Danny approves the
 * preview above it.
 *
 * 8 Oct 2026 (audit activation-1, activation-16, copy-4): one flag can cover
 * more than one case - the paid and trial plan_ended, a tracked and a
 * placements welcome, both market zones of a trial email and each of the
 * three bodies its recap can take - so every case its flag would send is
 * drawn under it, each labelled. lifecycle.test.mts holds the recap half:
 * trial_ending first drew only one of its three (review of 7e133a7).
 */
export default function EmailsAdmin() {
  const all = previewSets(TRACKED_PRICE);
  return (
    <div style={{ padding: "32px 24px 80px", maxWidth: "1180px", margin: "0 auto", color: T.ink }}>
      <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700 }}>Lifecycle emails</h1>
      <p style={{ margin: "8px 0 0", fontSize: "15px", color: T.soft, maxWidth: "70ch" }}>
        Previews on made-up data. None of these is sent until its flag is turned on, and each flag stays off until you approve the preview.
      </p>
      {LIFECYCLE_EMAILS.map((name) => (
        <section key={name} id={name} style={{ marginTop: "40px", paddingTop: "24px", borderTop: `1px solid ${T.line}` }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>{name}</h2>
          <p style={{ margin: "6px 0 0", fontSize: "14px", color: T.soft }}>
            Flag <code>{flagFor(name)}</code>, off{all[name].length > 1 ? ` - ${all[name].length} cases below, all sent under this one flag` : ""}
          </p>
          {all[name].map(({ label, mail: m }) => (
            <div key={label} style={{ marginTop: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>{label}</h3>
              <p style={{ margin: "4px 0 0", fontSize: "14px", color: T.soft }}>
                Subject: <strong style={{ color: T.ink }}>{m.subject}</strong>
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", marginTop: "12px", alignItems: "flex-start" }}>
                {WIDTHS.map((w) => (
                  <figure key={w.px} style={{ margin: 0, maxWidth: "100%" }}>
                    <figcaption style={{ fontSize: "13px", color: T.soft, marginBottom: "6px" }}>
                      {w.label}, {w.px}px
                    </figcaption>
                    <iframe
                      title={`${name}, ${label}, at ${w.px}px`}
                      srcDoc={m.html}
                      sandbox=""
                      style={{ width: `${w.px}px`, maxWidth: "100%", height: "720px", border: `1px solid ${T.line}`, borderRadius: "8px", background: T.surface }}
                    />
                  </figure>
                ))}
              </div>
              <details style={{ marginTop: "12px" }}>
                <summary style={{ cursor: "pointer", fontSize: "14px" }}>Plain text</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.55, background: T.chip, padding: "12px", borderRadius: "8px" }}>{m.text}</pre>
              </details>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
